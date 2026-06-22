// ponytail: assert-based self-check, no framework. Run: npx tsx src/server/matching/dupes.test.ts
import assert from "node:assert/strict";
import { findDuplicate } from "./dupes.ts";

const lib = [
  "Frank Herbert",
  "Frank Herbert/Dune",
  "Brandon Sanderson",
  "Brandon Sanderson/Mistborn/The Final Empire",
];

// Exact computed destination already present -> definite dupe.
assert.equal(
  findDuplicate("Frank Herbert/Dune", lib, "Frank Herbert/Dune"),
  "Frank Herbert/Dune",
);

// Fuzzy: the same title with extra noise still flags the close folder.
assert.equal(
  findDuplicate("Brandon Sanderson/Mistborn/The Final Empire (Unabridged)", lib),
  "Brandon Sanderson/Mistborn/The Final Empire",
);

// Unrelated title -> no warning.
assert.equal(findDuplicate("Andy Weir/Project Hail Mary", lib), undefined);

console.log("dupe detection: OK");
