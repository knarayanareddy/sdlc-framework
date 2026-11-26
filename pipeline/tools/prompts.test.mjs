// The prompts are part of the program: PHASES[].prompt names a file, and `pipeline next`
// prints that path. A missing or stub prompt means the orchestrator tells an agent to read
// a file that does not exist. That is a defect no other test would catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PHASES } from "./lib/gates.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const promptsDir = path.resolve(here, "..", "prompts");
const toolsDir = path.resolve(here);

const read = (f) => fs.readFileSync(path.join(promptsDir, f), "utf8");

test("every phase names a prompt that exists", () => {
  for (const p of PHASES) {
    const file = path.join(promptsDir, p.prompt);
    assert.ok(fs.existsSync(file), `phase ${p.id} → missing prompt ${p.prompt}`);
  }
});

test("every referenced prompt is substantive and starts with a heading", () => {
  const files = new Set(PHASES.map((p) => p.prompt));
  for (const f of files) {
    const text = read(f);
    assert.ok(text.length > 900, `${f} looks like a stub (${text.length} bytes)`);
    assert.match(text.split("\n")[0], /^# v2-/, `${f} must open with "# v2-…"`);
  }
});

test("every v2 prompt file is reachable from a phase or is the orchestrator/guardrail set", () => {
  const referenced = new Set(PHASES.map((p) => p.prompt));
  const extra = new Set(["v2-99-orchestrator.md"]);
  const onDisk = fs.readdirSync(promptsDir).filter((f) => f.startsWith("v2-"));
  for (const f of onDisk) {
    assert.ok(referenced.has(f) || extra.has(f), `${f} is not used by any phase`);
  }
});

test("every v2 prompt tells the agent which commands to run", () => {
  for (const f of fs.readdirSync(promptsDir).filter((x) => x.startsWith("v2-"))) {
    const text = read(f);
    assert.match(text, /pipeline\/bin\/pipeline\.mjs/, `${f} never mentions the orchestrator`);
  }
});

test("prompts never reference a tool that does not exist", () => {
  for (const f of fs.readdirSync(promptsDir).filter((x) => x.endsWith(".md"))) {
    const text = read(f);
    for (const m of text.matchAll(/tools\/([a-z0-9-]+\.mjs)/g)) {
      assert.ok(fs.existsSync(path.join(toolsDir, m[1])), `${f} references missing tool ${m[1]}`);
    }
  }
});

test("the v1 set is still present and untouched in shape", () => {
  for (let i = 0; i <= 10; i++) {
    const prefix = String(i).padStart(2, "0");
    const f = fs.readdirSync(promptsDir).find((x) => x.startsWith(prefix + "-") && x.endsWith(".md"));
    assert.ok(f, `v1 prompt ${prefix} is missing`);
  }
});

test("no prompt invites a gate to be passed from memory", () => {
  const banned = /(mark|record|set)\s+(the\s+)?gate\s+(as\s+)?(passed|green)\s+(without|from memory)/i;
  for (const f of fs.readdirSync(promptsDir).filter((x) => x.endsWith(".md"))) {
    assert.doesNotMatch(read(f), banned, `${f} allows an unverified pass`);
  }
});
