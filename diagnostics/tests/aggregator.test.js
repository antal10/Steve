"use strict";

const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseRun } = require("../lib/run-parser");
const { emitEvents } = require("../lib/event-emitter");
const { indexRun } = require("../lib/run-indexer");
const { aggregate } = require("../lib/aggregator");

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const RUN_FILES = [
  "2026-03-01_1015_run1.json",
  "2026-03-02_0910_run1.json",
  "2026-03-03_1415_run1.json",
  "2026-03-04_0830_run1.json",
];

function buildDataSet() {
  const allEvents = [];
  const indexes = [];

  for (const fileName of RUN_FILES) {
    const parsedRun = parseRun(path.join(FIXTURES_DIR, fileName));
    const events = emitEvents(parsedRun);
    allEvents.push(...events);
    indexes.push(indexRun(parsedRun, events));
  }

  return { allEvents, indexes };
}

test("aggregator summarizes totals, falls back to stages_completed, and excludes success traffic from top signatures", () => {
  const { allEvents, indexes } = buildDataSet();
  const summary = aggregate(indexes, allEvents);

  assert.equal(summary.total_runs, 4);
  assert.equal(summary.total_failures, 5);
  assert.equal(summary.date_range.start, "2026-03-01T10:15:00Z");
  assert.equal(summary.date_range.end, "2026-03-04T08:30:00Z");
  assert.equal(summary.per_agent_stats["@gemini"].failed_inferred, 1);
  assert.equal(summary.per_agent_stats["@sonar"].failed_inferred, 2);

  assert.equal(summary.top_signatures[0].signature, "run.partial.run_completed");
  assert.equal(summary.top_signatures.some((item) => item.signature === "broadcast.requested.agent_requested"), false);
  assert.equal(summary.top_signatures.some((item) => item.signature === "collect.completed.response_collected"), false);
  assert.equal(summary.top_signatures.some((item) => item.signature === "deliberation.completed.deliberation_reply_recorded"), false);

  assert.equal(summary.stage_completion_rates.broadcast.completion_rate, 1);
  assert.equal(summary.stage_completion_rates.collect.completion_rate, 0.75);
  assert.equal(summary.stage_completion_rates.deliberation.completion_rate, 0.5);
  assert.equal(summary.stage_completion_rates.minutes.completion_rate, 0.5);

  assert.deepEqual(summary.runs_with_failures, [
    {
      run_id: "2026-03-02_0910_run1",
      failure_count: 2,
      inferred_count: 1,
      artifact_path: path.join(FIXTURES_DIR, "2026-03-02_0910_run1.json"),
    },
    {
      run_id: "2026-03-03_1415_run1",
      failure_count: 3,
      inferred_count: 2,
      artifact_path: path.join(FIXTURES_DIR, "2026-03-03_1415_run1.json"),
    },
  ]);
});
