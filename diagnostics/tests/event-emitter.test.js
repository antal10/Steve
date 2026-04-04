"use strict";

const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseRun } = require("../lib/run-parser");
const { emitEvents } = require("../lib/event-emitter");

const FIXTURES_DIR = path.join(__dirname, "fixtures");

function loadEvents(name) {
  return emitEvents(parseRun(path.join(FIXTURES_DIR, name)));
}

test("event emitter infers missing opening responses and preserves stage order", () => {
  const events = loadEvents("2026-03-02_0910_run1.json");
  const eventTypes = events.map((event) => event.event_type);

  assert.equal(eventTypes[0], "run_started");
  assert.equal(eventTypes[eventTypes.length - 1], "run_completed");
  assert.deepEqual(eventTypes.slice(1, 4), [
    "agent_requested",
    "agent_requested",
    "agent_requested",
  ]);

  const missing = events.find((event) => event.event_type === "response_missing");
  assert.ok(missing);
  assert.equal(missing.agent, "@gemini");
  assert.equal(missing.confidence, "inferred");

  const lastCollectIndex = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.stage === "collect")
    .pop().index;
  const firstDeliberationIndex = events.findIndex((event) => event.stage === "deliberation");
  assert.ok(firstDeliberationIndex > lastCollectIndex);

  const eventIds = new Set(events.map((event) => event.event_id));
  assert.equal(eventIds.size, events.length);
});

test("event emitter marks fallback deliberation and minutes events as inferred", () => {
  const events = loadEvents("2026-03-03_1415_run1.json");

  const deliberationFallback = events.find((event) => event.event_type === "deliberation_reply_empty");
  assert.ok(deliberationFallback);
  assert.equal(deliberationFallback.agent, "@sonar");
  assert.equal(deliberationFallback.confidence, "inferred");

  const minutesFallback = events.find((event) => event.event_type === "minutes_fallback");
  assert.ok(minutesFallback);
  assert.equal(minutesFallback.agent, "@sonar");
  assert.equal(minutesFallback.confidence, "inferred");
});

test("event emitter derives partial run completion from Steve-native stages_completed", () => {
  const events = loadEvents("2026-03-04_0830_run1.json");
  const requestedAgents = events
    .filter((event) => event.event_type === "agent_requested")
    .map((event) => event.agent);
  const runCompleted = events[events.length - 1];

  assert.deepEqual(requestedAgents, ["@o3", "@claude"]);
  assert.equal(events.some((event) => event.stage === "deliberation"), false);
  assert.equal(events.some((event) => event.stage === "minutes"), false);
  assert.equal(runCompleted.event_type, "run_completed");
  assert.equal(runCompleted.outcome, "partial");
});
