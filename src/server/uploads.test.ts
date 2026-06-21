// ponytail: assert-based self-check. Run: npx tsx src/server/uploads.test.ts
import assert from "node:assert/strict";
import { safeRelPath } from "./uploads.ts";

// Legitimate paths pass through, normalised to forward slashes.
assert.equal(safeRelPath("Dune.m4b"), "Dune.m4b");
assert.equal(safeRelPath("Series/Book 1/pt1.m4b"), "Series/Book 1/pt1.m4b");
assert.equal(safeRelPath("Series\\Book 1\\pt1.m4b"), "Series/Book 1/pt1.m4b");
assert.equal(safeRelPath("/leading/slash.m4b"), "leading/slash.m4b");

// Traversal and absolute paths are rejected — this is the security boundary.
for (const bad of [
  "../etc/passwd",
  "a/../../b.m4b",
  "..",
  "/etc/../../../root/.ssh/x",
  "",
  "C:\\Windows\\system32\\x",
]) {
  assert.throws(() => safeRelPath(bad), `should reject: ${JSON.stringify(bad)}`);
}

console.log("upload path sanitization: OK");
