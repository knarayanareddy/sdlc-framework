#!/usr/bin/env node
// The sandbox profile (v2-00 §6): a place to execute code you do not trust, and an honest
// account of which protections are actually in force here.
//
//   node pipeline/tools/sandbox.mjs check
//   node pipeline/tools/sandbox.mjs run --cmd "npm test" --timeout 300000 --max-output 200000
//   node pipeline/tools/sandbox.mjs run --cmd "node exploit.mjs" --copy ./app --deny-network
//   node pipeline/tools/sandbox.mjs profile --out docker-compose.sandbox.yml
//   node pipeline/tools/sandbox.mjs verify --file docker-compose.sandbox.yml
//
// What `run` always does: a scrubbed environment (allowlist, no inherited secrets), an isolated
// temporary workdir (`--copy` gives the command a copy, never your tree), a hard timeout, an
// output cap, and a record of every control that was applied or could not be.
// What it does only if the host allows it: a network namespace, a memory rlimit. A control that
// could not be applied is NOT_VERIFIED — never silently skipped, never counted as green.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fail, ok, paint, parseArgs, writeJson } from "./lib/common.mjs";

const { flags, positional } = parseArgs();
const [command = "check"] = positional;

const ENV_ALLOWLIST = ["PATH", "LANG", "LANGUAGE", "TZ", "TMPDIR", "SYSTEMROOT", "COMSPEC", "PATHEXT"];
const SHELLS = ["/bin/sh", "/bin/bash"];

function which(bin) {
  const res = spawnSync(process.platform === "win32" ? "where" : "command", ["-v", bin], { shell: true, encoding: "utf8" });
  return res.status === 0;
}

function probe(cmd, timeout = 3000) {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8", timeout, stdio: "pipe" });
  return { ok: res.status === 0, status: res.status, stderr: (res.stderr ?? "").trim().split("\n")[0] ?? "" };
}

function capabilities() {
  const netns = probe("unshare -n true");
  const userns = probe("unshare -Ur true");
  const memLimit = probe(`${SHELLS[0]} -c 'ulimit -v 262144 2>/dev/null && echo ok'`);
  const timeoutBin = probe("command -v timeout >/dev/null 2>&1");
  return {
    networkNamespace: { available: netns.ok, how: netns.ok ? "unshare -n" : netns.stderr || "unshare failed", consequence: netns.ok ? null : "the command keeps your network access" },
    userNamespace: { available: userns.ok, how: userns.ok ? "unshare -Ur" : userns.stderr || "unavailable" },
    memoryLimit: { available: memLimit.ok, how: memLimit.ok ? "ulimit -v" : memLimit.stderr || "unavailable" },
    timeoutBinary: { available: timeoutBin.ok, how: timeoutBin.ok ? "timeout(1)" : "node spawnSync timeout only" },
    bubblewrap: { available: which("bwrap"), how: "bwrap" },
    docker: { available: which("docker"), how: "docker" },
    platform: process.platform,
  };
}

function cmdCheck() {
  const caps = capabilities();
  if (flags.json) {
    console.log(JSON.stringify(caps, null, 2));
    return;
  }
  console.log(paint.bold("sandbox capabilities on this host"));
  for (const [name, c] of Object.entries(caps)) {
    if (name === "platform") continue;
    const mark = c.available ? paint.green("yes") : paint.yellow("no ");
    console.log(`  ${mark} ${name.padEnd(18)} ${c.how}${c.consequence ? paint.yellow(`  — ${c.consequence}`) : ""}`);
  }
  console.log(`  ${paint.dim("platform")} ${caps.platform}`);
  const strong = caps.docker.available || (caps.bubblewrap.available && caps.networkNamespace.available);
  console.log(
    strong
      ? paint.green("a full sandbox is available here (docker, or bwrap + netns)")
      : paint.yellow("no full sandbox here: `run` applies the controls it can and marks the rest NOT_VERIFIED"),
  );
  console.log(`human path to a full sandbox: node pipeline/tools/sandbox.mjs profile --out docker-compose.sandbox.yml && docker compose -f docker-compose.sandbox.yml run --rm sandbox <cmd>`);
  if (flags.out) {
    writeJson(String(flags.out), caps);
    console.log(`written: ${flags.out}`);
  }
}

function buildEnv(keep, extra) {
  const env = { TERM: "dumb", NO_COLOR: "1", CI: "1" };
  for (const key of [...ENV_ALLOWLIST, ...keep]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const pair of extra) {
    const i = pair.indexOf("=");
    if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return env;
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => !/(^|\/)(node_modules|\.git|\.next|dist|build|coverage)(\/|$)/.test(p.slice(src.length)),
  });
}

function cmdRun() {
  const cmd = flags.cmd ? String(flags.cmd) : null;
  if (!cmd) fail("nothing to run — pass --cmd \"<command>\"");
  const timeout = Number(flags.timeout ?? 300_000);
  const maxOutput = Number(flags["max-output"] ?? 200_000);
  const keep = String(flags["keep-env"] ?? "").split(",").filter(Boolean);
  const extra = String(flags.env ?? "").split(",").filter(Boolean);

  const caps = capabilities();
  const controls = {};
  const notes = [];

  // 1 · isolated workdir. --copy hands the command a copy so it cannot mutate the source tree.
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-sandbox-"));
  if (flags.copy && flags.copy !== true) {
    copyDir(path.resolve(String(flags.copy)), workdir);
    controls.workdirIsolated = true;
    notes.push(`ran against a copy of ${flags.copy}`);
  } else {
    // There is no isolation unless --copy put the command in its own tree. Claiming
    // `true` here while --cwd points at the real project was a false control.
    controls.workdirIsolated = !flags.cwd;
  }

  // 2 · scrubbed environment
  const env = buildEnv(keep, extra);
  env.HOME = workdir;
  env.TMPDIR = workdir;
  controls.envScrubbed = true;
  const inheritedSecrets = Object.keys(process.env).filter((k) => /(TOKEN|SECRET|KEY|PASSWORD|PASS|CREDENTIAL|_AUTH)/i.test(k));
  if (inheritedSecrets.length) notes.push(`not passed through: ${inheritedSecrets.length} secret-looking variable(s)`);

  // 3 · network
  let shellCmd = cmd;
  if (flags["deny-network"]) {
    if (caps.networkNamespace.available) {
      shellCmd = `unshare -n ${cmd}`;
      controls.networkDenied = true;
    } else {
      controls.networkDenied = "NOT_VERIFIED";
      notes.push(`network could not be denied: ${caps.networkNamespace.how}`);
    }
  } else {
    controls.networkDenied = false;
    notes.push("network was NOT denied (pass --deny-network)");
  }

  // 4 · memory rlimit. `ulimit` is a shell builtin, so it must run inside the shell that
  // then runs the command — `timeout ulimit -v …; cmd` made timeout die on a non-binary and
  // left the command with neither control while both were reported as applied (F-11).
  const inner = cmd;
  let needsShell = false;
  if (flags["memory-mb"] && caps.memoryLimit.available) {
    needsShell = true;
    controls.memoryLimited = true;
  } else if (flags["memory-mb"]) {
    controls.memoryLimited = "NOT_VERIFIED";
    notes.push("memory rlimit unavailable on this host");
  }

  // 5 · timeout wraps the whole shell, so the limit applies to the command, not to the
  // rlimit call. Both controls now compose: `timeout -s KILL N sh -c 'ulimit -v X; cmd'`.
  const useTimeout = Boolean(flags.timeout && caps.timeoutBinary.available && process.platform !== "win32");
  if (needsShell) {
    const limit = Number(flags["memory-mb"]) * 1024;
    const quoted = `'${inner.replace(/'/g, `'\\''`)}'`;
    shellCmd = `ulimit -v ${limit} 2>/dev/null; exec sh -c ${quoted}`;
    // `exec` replaces this shell with the inner one, so the timeout kills the command
    // itself rather than a wrapper.
    shellCmd = `sh -c ${`'${shellCmd.replace(/'/g, `'\\''`)}'`}`;
  }
  if (flags["deny-network"] && caps.networkNamespace.available) {
    shellCmd = `unshare -n ${shellCmd}`;
  }
  if (useTimeout) {
    shellCmd = `timeout -s KILL ${Math.ceil(timeout / 1000)} ${shellCmd}`;
  }
  // --require-all must gate execution, not describe it afterwards. It used to run the
  // command and then refuse to call the run sandboxed (F-11).
  // A control that is simply `false` is a control that is NOT applied. --require-all used to
  // look only for the string NOT_VERIFIED, so without --deny-network the command ran with
  // network and still reported "4 control(s) applied" (SECOND-OPINION-3 G-18).
  const unverifiedBefore = Object.entries(controls)
    .filter(([, v]) => v === "NOT_VERIFIED" || v === false)
    .map(([k]) => k);
  if (flags["require-all"] && unverifiedBefore.length) {
    console.error(paint.red(`--require-all: refusing to execute — ${unverifiedBefore.join(", ")} cannot be enforced on this host`));
    console.error(`[sandbox] human command: node pipeline/tools/sandbox.mjs profile --out docker-compose.sandbox.yml && docker compose -f docker-compose.sandbox.yml run --rm sandbox <cmd>`);
    if (flags.out) {
      writeJson(path.resolve(String(flags.out)), {
        controls,
        unverified: unverifiedBefore,
        executed: false,
        command: cmd,
        at: new Date().toISOString(),
      });
    }
    fs.rmSync(workdir, { recursive: true, force: true });
    process.exit(3);
  }

  const started = Date.now();
  const res = spawnSync(shellCmd, {
    shell: true,
    cwd: flags.cwd ? path.resolve(String(flags.cwd)) : workdir,
    env,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const durationMs = Date.now() - started;

  const timedOut = res.signal === "SIGKILL" || res.status === 124 || res.error?.code === "ETIMEDOUT";
  controls.timeoutEnforced = true;

  const stdoutRaw = res.stdout ?? "";
  const stderrRaw = res.stderr ?? "";
  const truncated = stdoutRaw.length > maxOutput || stderrRaw.length > maxOutput;
  const stdout = stdoutRaw.slice(0, maxOutput);
  const stderr = stderrRaw.slice(0, maxOutput);
  controls.outputCapped = true;

  const exitCode = timedOut ? 124 : res.status === null ? 1 : res.status;
  const record = {
    command: cmd,
    cwd: flags.cwd ? String(flags.cwd) : workdir,
    isolated: !flags.cwd,
    exitCode,
    timedOut,
    durationMs,
    timeoutMs: timeout,
    truncated,
    controls,
    notes,
    stdoutBytes: stdoutRaw.length,
    stderrBytes: stderrRaw.length,
    at: new Date().toISOString(),
  };

  if (flags.out) {
    writeJson(String(flags.out), record);
  } else if (flags.log) {
    writeJson(String(flags.log), record);
  }

  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const applied = Object.values(controls).filter((v) => v === true).length;
  const unverified = Object.entries(controls).filter(([, v]) => v === "NOT_VERIFIED").map(([k]) => k);
  const summary = timedOut ? paint.yellow(`exit 124 (killed after ${timeout} ms)`) : exitCode === 0 ? paint.green("exit 0") : paint.red(`exit ${exitCode}`);
  console.error(`\n[sandbox] ${summary} in ${durationMs} ms · ${applied} control(s) applied${truncated ? " · output truncated" : ""}`);
  for (const n of notes) console.error(`[sandbox] ${paint.dim(n)}`);
  // The rlimit is now enforced (it used to be silently skipped), and `ulimit -v` bounds
  // *virtual address space*: a JS runtime reserves gigabytes of it before running a line,
  // so a limit that looks generous kills the runtime at startup. Say so instead of
  // leaving a 133 behind.
  if (controls.memoryLimited === true && [133, 134, 135, 137, 139].includes(exitCode) && durationMs < 1000) {
    console.error(
      `[sandbox] ${paint.yellow(`exit ${exitCode} within ${durationMs} ms under --memory-mb ${flags["memory-mb"]}`)} — ulimit -v limits virtual address space, which a JS runtime reserves in GB; try --memory-mb 4096`,
    );
  }
  if (unverified.length) console.error(`[sandbox] ${paint.yellow(`NOT_VERIFIED: ${unverified.join(", ")}`)} — the report must say so`);

  if (flags["require-all"] && unverified.length) {
    console.error(`[sandbox] ${paint.red("--require-all: refusing to call this execution sandboxed")}`);
    console.error(`[sandbox] human command: node pipeline/tools/sandbox.mjs profile --out docker-compose.sandbox.yml && docker compose -f docker-compose.sandbox.yml run --rm sandbox <cmd>`);
    process.exit(3);
  }

  if (flags.keep !== undefined) console.error(`[sandbox] workdir kept: ${workdir}`);
  else fs.rmSync(workdir, { recursive: true, force: true });

  process.exit(exitCode);
}

const PROFILE = `# Generated by pipeline/tools/sandbox.mjs — a hardened profile for code you do not trust.
# Usage:  docker compose -f docker-compose.sandbox.yml build
#         docker compose -f docker-compose.sandbox.yml run --rm sandbox <command>
# Verify: node pipeline/tools/sandbox.mjs verify --file docker-compose.sandbox.yml
services:
  sandbox:
    build:
      context: .
      dockerfile: Dockerfile.sandbox
    image: pipeline-sandbox:local
    network_mode: "none"
    read_only: true
    user: "65534:65534"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 128
    mem_limit: 1g
    cpu_shares: 512
    ulimits:
      nofile:
        soft: 256
        hard: 512
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=256m
      # /work is the read-only bind mount below; a tmpfs here shadowed it and the
      # container saw an empty directory (F-12).
    working_dir: /work
    environment:
      - CI=1
      - NO_COLOR=1
    volumes:
      - ./:/work:ro
`;

const DOCKERFILE = `# Generated by pipeline/tools/sandbox.mjs. Node 22, no package manager cache, no root.
FROM node:22-alpine
RUN adduser -D -u 65534 sandbox 2>/dev/null || true
USER 65534:65534
WORKDIR /work
`;

function cmdProfile() {
  const out = String(flags.out ?? "docker-compose.sandbox.yml");
  fs.writeFileSync(out, PROFILE);
  if (flags.dockerfile !== false) fs.writeFileSync(path.join(path.dirname(out), "Dockerfile.sandbox"), DOCKERFILE);
  console.log(`wrote ${out} and Dockerfile.sandbox`);
  const problems = validateProfile(PROFILE);
  if (problems.length) {
    for (const p of problems) console.error(paint.red(`  - ${p}`));
    fail("the generated profile failed its own validation (this is a bug)");
  }
  ok("profile passes every control check");
  console.log(`next: docker compose -f ${out} run --rm sandbox npm test`);
}

const REQUIRED_LINES = [
  { key: "network_mode", re: /^\s*network_mode:\s*"?none"?\s*$/m, why: "network must be disabled" },
  { key: "read_only", re: /^\s*read_only:\s*true\s*$/m, why: "the root filesystem must be read-only" },
  { key: "cap_drop_ALL", re: /cap_drop:\s*\n\s*-\s*ALL/m, why: "all capabilities must be dropped" },
  { key: "no_new_privileges", re: /no-new-privileges:true/m, why: "no-new-privileges is required" },
  { key: "pids_limit", re: /^\s*pids_limit:\s*\d+/m, why: "pids must be limited (fork bombs)" },
  { key: "mem_limit", re: /^\s*mem_limit:\s*\S+/m, why: "memory must be limited" },
  { key: "ulimits", re: /^\s*ulimits:/m, why: "file descriptors must be limited" },
  { key: "tmpfs", re: /^\s*tmpfs:/m, why: "writable space must be tmpfs, not the image" },
];

const FORBIDDEN = [
  { re: /^\s*privileged:\s*true\s*$/m, why: "privileged mode disables everything else here" },
  { re: /^\s*network_mode:\s*"?host"?\s*$/m, why: "host networking escapes the network control" },
  { re: /^\s*user:\s*"?0(:0)?"?\s*$/m, why: "the container must not run as root" },
  { re: /docker\.sock/m, why: "mounting the docker socket is a full escape" },
  { re: /^\s*ipc:\s*"?host"?\s*$/m, why: "host IPC shares memory with the host" },
  { re: /:\s*rw\s*$/m, why: "no writable bind mounts of the host tree" },
  // Everything below was invisible to the old file-wide lint: `cap_add: SYS_ADMIN`,
  // `seccomp=unconfined`, `pid: host`, `devices:` and a plain read-write bind all passed
  // (SECOND-OPINION-3 G-18).
  { re: /^\s*cap_add:/m, why: "cap_add re-grants capabilities after cap_drop: ALL" },
  { re: /^\s*seccomp\s*=\s*unconfined|^\s*seccomp:unconfined/m, why: "seccomp=unconfined removes the syscall filter" },
  { re: /^\s*apparmor\s*=\s*unconfined/m, why: "apparmor=unconfined removes the mandatory access control" },
  { re: /^\s*pid:\s*"?host"?\s*$/m, why: "host PID namespace lets the container see and signal host processes" },
  { re: /^\s*userns_mode:\s*"?host"?\s*$/m, why: "host user namespace drops the uid mapping" },
  { re: /^\s*devices:/m, why: "device passthrough reaches host hardware" },
  { re: /^\s*label:\s*disable/m, why: "disabling the security label removes the MAC on the container" },
  // A bind mount is writable unless it says otherwise; `:ro` has to be there.
  { re: /^\s*-\s*[./]/, why: "every bind mount must end in :ro", onlyIfNoRo: true },
];

function validateProfile(text) {
  const problems = [];
  for (const r of REQUIRED_LINES) if (!r.re.test(text)) problems.push(`missing ${r.key}: ${r.why}`);
  for (const f of FORBIDDEN) {
    if (!f.re.test(text)) continue;
    if (f.onlyIfNoRo) {
      // Only the volume lines, and only when the same line does not say :ro.
      const bad = text.split("\n").filter((line) => /^\s*-\s*[./]/.test(line) && line.includes(":") && !/:(ro|ro,Z|ro,z)\s*$/.test(line.trim()));
      if (!bad.length) continue;
    }
    problems.push(`forbidden: ${f.why}`);
  }
  const userLine = text.match(/^\s*user:\s*"?([\d:]+)"?\s*$/m);
  if (!userLine) problems.push("missing user: the container must name a non-root uid");
  return problems;
}

function cmdVerify() {
  const file = String(flags.file ?? "docker-compose.sandbox.yml");
  if (!fs.existsSync(file)) {
    console.log(paint.yellow(`NOT_VERIFIED: no sandbox profile at ${file}`));
    console.log(`human command: node pipeline/tools/sandbox.mjs profile --out ${file} && docker compose -f ${file} run --rm sandbox <cmd>`);
    process.exit(3);
  }
  const problems = validateProfile(fs.readFileSync(file, "utf8"));
  if (flags.json) {
    console.log(JSON.stringify({ file, problems, result: problems.length ? "FAIL" : "PASS" }, null, 2));
  } else {
    for (const p of problems) console.log(`PROBLEM ${p}`);
    console.log(problems.length ? "RESULT: FAIL" : "RESULT: PASS");
  }
  process.exit(problems.length ? 1 : 0);
}

const commands = { check: cmdCheck, run: cmdRun, profile: cmdProfile, verify: cmdVerify, help: cmdCheck };
if (!commands[command]) fail(`unknown command "${command}". Known: ${Object.keys(commands).join(", ")}`);
commands[command]();
