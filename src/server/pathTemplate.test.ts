// ponytail: assert-based self-check, no framework. Run: npx tsx src/server/pathTemplate.test.ts
import assert from "node:assert/strict";
import { buildDestPath } from "./pathTemplate.ts";

const tmpl = "{author}/{series}/{title}";
const book = { author: "Frank Herbert", title: "Dune" };

// Matched single file: named after the title, dropped in the resolved folder.
assert.equal(
  buildDestPath(tmpl, book, "whatever.m4b").relPath,
  "Frank Herbert/Dune/Dune.m4b",
);

// Flat multi-part files keep distinct names via the part label.
assert.equal(
  buildDestPath(tmpl, book, "p1.m4b", "part 1 of 2").relPath,
  "Frank Herbert/Dune/Dune part 1 of 2.m4b",
);

// Folder-per-book parts keep their original filenames but route into the book
// folder — two chapters that share a number must NOT collide.
const folderBook = { author: "Eliezer Yudkowsky", title: "HPMOR" };
const a = buildDestPath(
  tmpl,
  folderBook,
  "Chapter 100_ Precautionary Measures, Pt 1 (Part 1) [B0CBMK67YJ].mp3",
  "Chapter 100",
  true,
).relPath;
const b = buildDestPath(
  tmpl,
  folderBook,
  "Chapter 100_ Precautionary Measures, Pt 1 (Part 2) [B0CBTYZWZB].mp3",
  "Chapter 100",
  true,
).relPath;
assert.equal(a.startsWith("Eliezer Yudkowsky/HPMOR/"), true, a);
assert.notEqual(a, b, "folder-per-book chapters must not collide");

console.log("pathTemplate: OK");
