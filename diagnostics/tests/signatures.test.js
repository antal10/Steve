"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { assignSignature, KNOWN_SIGNATURES } = require("../lib/signatures");

test("signature assignment is deterministic and normalized", () => {
  assert.equal(
    assignSignature("Minutes", "Partial", "minutes_fallback"),
    "minutes.partial.minutes_fallback"
  );
  assert.equal(
    assignSignature("Collect Stage", "Missing", "response missing"),
    "collect_stage.missing.response_missing"
  );
});

test("known signatures include inferred fallback signatures", () => {
  assert.equal(KNOWN_SIGNATURES.includes("deliberation.missing.deliberation_reply_empty"), true);
  assert.equal(KNOWN_SIGNATURES.includes("minutes.partial.minutes_fallback"), true);
});
