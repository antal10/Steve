"use strict";

const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseRun } = require("../lib/run-parser");
const { emitEvents } = require("../lib/event-emitter");
const { indexRun } = require("../lib/run-indexer");

const FIXTURES_DIR = path.join(__dirname, "fixtures");

function loadIndexedRun(name) {
  const parsedRun = parseRun(path.join(FIXTURES_DIR, name));
  const events = emitEvents(parsedRun);
  return indexRun(parsedRun, events);
}

test("run index captures inferred missing agents and post counts", () => {
  const index = loadIndexedRun("2026-03-02_0910_run1.json");

  assert.deepEqual(index.agents_requested, ["@o3", "@gemini", "@claude"]);
  assert.deepEqual(index.agents_responded, ["@o3", "@claude"]);
  assert.deepEqual(index.agents_failed_inferred, ["@gemini"]);
  assert.equal(index.opening_posts, 2);
  assert.equal(index.deliberation_posts, 2);
  assert.equal(index.minutes_posts, 1);
  assert.equal(index.failure_count, 2);
});

test("run index preserves minutes agent and consensus for healthy runs", () => {
  const index = loadIndexedRun("2026-03-01_1015_run1.json");

  assert.equal(index.minutes_agent, "@sonar");
  assert.equal(index.consensus_level, "moderate");
  assert.equal(index.failure_count, 0);
  assert.equal(index.event_count > 0, true);
});
