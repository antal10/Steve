"use strict";

function normalizeSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "unknown";
}

function assignSignature(stage, outcome, detailTag) {
  return [
    normalizeSegment(stage),
    normalizeSegment(outcome),
    normalizeSegment(detailTag),
  ].join(".");
}

const KNOWN_SIGNATURES = Object.freeze([
  assignSignature("run", "started", "run_started"),
  assignSignature("broadcast", "requested", "agent_requested"),
  assignSignature("broadcast", "failed", "failure_recorded"),
  assignSignature("collect", "completed", "response_collected"),
  assignSignature("collect", "partial", "response_collected"),
  assignSignature("collect", "missing", "response_missing"),
  assignSignature("collect", "failed", "failure_recorded"),
  assignSignature("deliberation", "completed", "deliberation_reply_recorded"),
  assignSignature("deliberation", "partial", "deliberation_reply_recorded"),
  assignSignature("deliberation", "missing", "deliberation_reply_empty"),
  assignSignature("deliberation", "skipped", "deliberation_skipped"),
  assignSignature("deliberation", "failed", "failure_recorded"),
  assignSignature("minutes", "completed", "minutes_recorded"),
  assignSignature("minutes", "partial", "minutes_recorded"),
  assignSignature("minutes", "partial", "minutes_fallback"),
  assignSignature("minutes", "failed", "minutes_fallback"),
  assignSignature("minutes", "skipped", "minutes_skipped"),
  assignSignature("minutes", "failed", "failure_recorded"),
  assignSignature("run", "completed", "run_completed"),
  assignSignature("run", "partial", "run_completed"),
  assignSignature("run", "failed", "run_completed"),
]);

module.exports = {
  assignSignature,
  KNOWN_SIGNATURES,
};
