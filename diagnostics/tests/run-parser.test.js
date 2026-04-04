"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { discoverRuns } = require("../lib/artifact-discovery");
const { parseRun } = require("../lib/run-parser");

const FIXTURES_DIR = path.join(__dirname, "fixtures");

function fixture(name) {
  return path.join(FIXTURES_DIR, name);
}

test("artifact discovery returns sorted json fixture paths oldest first", () => {
  const discovered = discoverRuns(FIXTURES_DIR).map((filePath) => path.basename(filePath));
  assert.deepEqual(discovered, [
    "2026-03-01_1015_run1.json",
    "2026-03-02_0910_run1.json",
    "2026-03-03_1415_run1.json",
    "2026-03-04_0830_run1.json",
    "malformed-run.json",
  ]);
});

test("run parser normalizes missing stages and minutes", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostics-run-parser-"));
  const tempFile = path.join(tempDir, "missing-fields.json");
  fs.writeFileSync(tempFile, JSON.stringify({ run_id: "tmp", timestamp: "2026-03-04T00:00:00Z" }), "utf-8");

  const parsed = parseRun(tempFile);

  assert.equal(parsed.run.run_id, "tmp");
  assert.deepEqual(parsed.run.stages_completed, []);
  assert.deepEqual(parsed.run.minutes, {});
  assert.equal(parsed.warnings.length, 2);
});

test("run parser accepts Steve-native fixture shapes without synthetic runtime fields", () => {
  const parsed = parseRun(fixture("2026-03-04_0830_run1.json"));

  assert.ok(parsed.run);
  assert.equal(parsed.run.status, "unknown");
  assert.deepEqual(parsed.run.stage_timestamps, {});
  assert.deepEqual(parsed.run.prompt_dispatches, []);
  assert.deepEqual(parsed.run.failures, []);
  assert.deepEqual(parsed.run.agent_statuses, {});
  assert.deepEqual(parsed.run.stages_completed, ["broadcast", "collect"]);
  assert.equal(parsed.warnings.length, 0);
});

test("run parser returns a non-fatal warning for malformed files", () => {
  const parsed = parseRun(fixture("malformed-run.json"));
  assert.equal(parsed.run, null);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /Unable to parse/);
});
