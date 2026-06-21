// ponytail: assert-based self-check, no framework. Run: npx tsx src/server/matching/filename.test.ts
import assert from "node:assert/strict";
import { extractPart, parseFilename } from "./filename.ts";

// Collation depends on every part-file of one title yielding the SAME query,
// while a genuinely different title yields a different one.
const dune = [
  "Dune part 1 of 2.m4b",
  "Dune part 2 of 2.m4b",
  "Dune_pt.1.m4b",
  "Dune disc 3.mp3",
].map((n) => parseFilename(n).query);
assert.equal(new Set(dune).size, 1, `parts should collate: ${dune}`);
assert.equal(dune[0], "Dune");
assert.notEqual(parseFilename("Mistborn.m4b").query, dune[0]);

// The part designation is preserved separately so destination files don't collide.
assert.equal(extractPart("Dune part 1 of 2.m4b"), "part 1 of 2");
assert.equal(extractPart("Dune.m4b"), undefined);

console.log("filename collation: OK");
