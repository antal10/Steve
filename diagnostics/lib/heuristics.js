"use strict";

const DELIBERATION_FALLBACK_PREFIX = "(No explicit reply";
const MINUTES_FALLBACK_CONSENSUS = "unresolved";
const MINUTES_FALLBACK_TEXTS = Object.freeze([
  "minutes response was empty.",
  "minutes response did not fully satisfy the structured schema.",
  "minutes generation failed.",
  "no structured minutes were available.",
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function isEmptyArray(value) {
  return !Array.isArray(value) || value.length === 0;
}

function isDeliberationFallback(postContent) {
  return normalizeText(postContent).startsWith(DELIBERATION_FALLBACK_PREFIX);
}

function isMinutesFallback(minutesObj) {
  if (!minutesObj || typeof minutesObj !== "object" || Array.isArray(minutesObj)) {
    return false;
  }

  const arraysAreEmpty = isEmptyArray(minutesObj.points_of_agreement)
    && isEmptyArray(minutesObj.points_of_disagreement)
    && isEmptyArray(minutesObj.unresolved_questions);

  const consensusMatches = normalizeText(minutesObj.consensus_level).toLowerCase()
    === MINUTES_FALLBACK_CONSENSUS;

  if (!arraysAreEmpty || !consensusMatches) {
    return false;
  }

  const candidateTexts = [
    minutesObj.raw_minutes_text,
    minutesObj.raw_response_text,
    minutesObj.reason,
    minutesObj.error,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean);

  return MINUTES_FALLBACK_TEXTS.some((needle) => {
    return candidateTexts.some((candidate) => candidate.includes(needle));
  });
}

module.exports = {
  DELIBERATION_FALLBACK_PREFIX,
  MINUTES_FALLBACK_CONSENSUS,
  MINUTES_FALLBACK_TEXTS,
  isDeliberationFallback,
  isMinutesFallback,
};
