"use strict";

const EVENT_TYPES = Object.freeze([
  "run_started",
  "agent_requested",
  "response_collected",
  "response_missing",
  "failure_recorded",
  "deliberation_reply_recorded",
  "deliberation_reply_empty",
  "deliberation_skipped",
  "minutes_recorded",
  "minutes_fallback",
  "minutes_skipped",
  "run_completed",
]);

const STAGES = Object.freeze([
  "run",
  "broadcast",
  "collect",
  "deliberation",
  "minutes",
]);

const OUTCOMES = Object.freeze([
  "started",
  "requested",
  "completed",
  "partial",
  "missing",
  "skipped",
  "failed",
]);

const SOURCES = Object.freeze(["artifact"]);
const CONFIDENCES = Object.freeze(["authoritative", "inferred"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateEvent(obj) {
  if (!isPlainObject(obj)) {
    return false;
  }

  if (typeof obj.event_id !== "string" || !obj.event_id.startsWith("evt_")) {
    return false;
  }

  if (typeof obj.run_id !== "string" || !obj.run_id) {
    return false;
  }

  if (typeof obj.timestamp !== "string") {
    return false;
  }

  if (!isNonNegativeInteger(obj.seq)) {
    return false;
  }

  if (typeof obj.agent !== "string" || !obj.agent) {
    return false;
  }

  if (!STAGES.includes(obj.stage)) {
    return false;
  }

  if (!EVENT_TYPES.includes(obj.event_type)) {
    return false;
  }

  if (!OUTCOMES.includes(obj.outcome)) {
    return false;
  }

  if (typeof obj.signature !== "string" || !obj.signature) {
    return false;
  }

  if (typeof obj.message !== "string") {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(obj, "detail")) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(obj, "artifact_ref")) {
    return false;
  }

  if (!SOURCES.includes(obj.source)) {
    return false;
  }

  if (!CONFIDENCES.includes(obj.confidence)) {
    return false;
  }

  return true;
}

function validateRunIndex(obj) {
  if (!isPlainObject(obj)) {
    return false;
  }

  if (typeof obj.run_id !== "string" || !obj.run_id) {
    return false;
  }

  if (typeof obj.timestamp !== "string") {
    return false;
  }

  if (typeof obj.prompt_preview !== "string") {
    return false;
  }

  if (!isStringArray(obj.agents_requested)) {
    return false;
  }

  if (!isStringArray(obj.agents_responded)) {
    return false;
  }

  if (!isStringArray(obj.agents_failed_inferred)) {
    return false;
  }

  if (!isStringArray(obj.stages_completed)) {
    return false;
  }

  if (!isNonNegativeInteger(obj.total_posts)) {
    return false;
  }

  if (!isNonNegativeInteger(obj.opening_posts)) {
    return false;
  }

  if (!isNonNegativeInteger(obj.deliberation_posts)) {
    return false;
  }

  if (!isNonNegativeInteger(obj.minutes_posts)) {
    return false;
  }

  if (!(obj.duration_seconds === null || typeof obj.duration_seconds === "number")) {
    return false;
  }

  if (!(obj.minutes_agent === null || typeof obj.minutes_agent === "string")) {
    return false;
  }

  if (!(obj.consensus_level === null || typeof obj.consensus_level === "string")) {
    return false;
  }

  if (!isNonNegativeInteger(obj.event_count)) {
    return false;
  }

  if (!isNonNegativeInteger(obj.failure_count)) {
    return false;
  }

  if (typeof obj.artifact_path !== "string" || !obj.artifact_path) {
    return false;
  }

  return true;
}

module.exports = {
  EVENT_TYPES,
  STAGES,
  OUTCOMES,
  SOURCES,
  CONFIDENCES,
  validateEvent,
  validateRunIndex,
};
