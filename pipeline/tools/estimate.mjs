#!/usr/bin/env node
// Chapman capture–recapture estimate for the red-team stop rule (v2-08 §8.10′).
// N̂ = ((nA + 1)(nB + 1)) / (m + 1) − 1
//
//   node pipeline/tools/estimate.mjs --a 6 --b 5 --m 4 [--json] [--fail-if-continue]
//
// Rules that matter more than the arithmetic:
//   - m = 0 gives no estimate (run another FULL round);
//   - two empty runs are not evidence of a clean codebase;
//   - the estimate assumes independent hunts and equally findable bugs, so it is optimistic.
//     Cross-model rounds reduce the bias; they do not remove it.
import { parseArgs, fail } from "./lib/common.mjs";

const { flags } = parseArgs();
const nA = Number(flags.a ?? flags.nA);
const nB = Number(flags.b ?? flags.nB);
const m = Number(flags.m);

const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= 100_000;
const emit = (obj, code = 0) => {
  if (flags.json) console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
};

if (![nA, nB, m].every(isCount)) fail("--a, --b and --m must be whole numbers >= 0");
if (m > Math.min(nA, nB)) fail("the overlap (--m) cannot exceed the smaller run");

const union = nA + nB - m;

if (m === 0) {
  const reason =
    nA + nB === 0
      ? "Both runs found nothing. That is not evidence of a clean codebase. Run planted-bug calibration."
      : "No overlap means no estimate. Run another full round.";
  if (flags.json) emit({ ok: false, reason, union });
  console.log(`union: ${union}`);
  console.log(`estimate: none — ${reason}`);
  console.log("RESULT: CONTINUE");
  process.exit(flags["fail-if-continue"] ? 1 : 0);
}

const total = ((nA + 1) * (nB + 1)) / (m + 1) - 1;
const remaining = Math.max(0, total - union);
const stop = remaining <= 1;

if (flags.json) emit({ ok: true, nA, nB, m, union, total, remaining, stop });

console.log(`runs: A=${nA} B=${nB} overlap=${m}  union=${union}`);
console.log(`estimated total: ${total.toFixed(2)}  expected remaining: ${remaining.toFixed(2)}`);
console.log(
  stop
    ? "RESULT: STOP is permitted only if a FULL round also produced 0 new confirmed findings."
    : "RESULT: CONTINUE — run another FULL round (max 3).",
);
console.log("caveat: assumes independent hunts and equally findable bugs; the number is optimistic.");
process.exit(flags["fail-if-continue"] && !stop ? 1 : 0);
