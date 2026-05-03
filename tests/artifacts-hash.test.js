const test = require("node:test");
const assert = require("node:assert/strict");

const { sha256, hashString, hashJson, canonicalJson } = require("../council/artifacts/hash");

test("sha256 is deterministic and prefixed", () => {
  const a = sha256(Buffer.from("hello"));
  const b = sha256(Buffer.from("hello"));
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

test("hashString matches sha256 of the same bytes", () => {
  assert.equal(hashString("hello"), sha256(Buffer.from("hello", "utf-8")));
});

test("canonicalJson sorts keys so equivalent objects hash the same", () => {
  const a = { b: 1, a: 2, nested: { y: 3, x: 4 } };
  const b = { nested: { x: 4, y: 3 }, a: 2, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(hashJson(a), hashJson(b));
});

test("canonicalJson distinguishes different content", () => {
  assert.notEqual(hashJson({ a: 1 }), hashJson({ a: 2 }));
});
