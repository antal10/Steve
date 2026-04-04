"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DELIBERATION_FALLBACK_PREFIX,
  MINUTES_FALLBACK_CONSENSUS,
  isDeliberationFallback,
  isMinutesFallback,
} = require("../lib/heuristics");

test("heuristics detects deliberation fallback prefixes exactly where expected", () => {
  assert.equal(isDeliberationFallback(`${DELIBERATION_FALLBACK_PREFIX} could be reconstructed.)`), true);
  assert.equal(isDeliberationFallback("A normal reply to @sonar."), false);
});

test("heuristics detects minutes fallbacks only when structure and text both match", () => {
  assert.equal(isMinutesFallback({
    points_of_agreement: [],
    points_of_disagreement: [],
    unresolved_questions: [],
    consensus_level: MINUTES_FALLBACK_CONSENSUS,
    raw_minutes_text: "Minutes response did not fully satisfy the structured schema.",
  }), true);

  assert.equal(isMinutesFallback({
    points_of_agreement: ["Real structure exists."],
    points_of_disagreement: [],
    unresolved_questions: [],
    consensus_level: MINUTES_FALLBACK_CONSENSUS,
    raw_minutes_text: "Minutes response did not fully satisfy the structured schema.",
  }), false);
});
