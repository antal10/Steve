"use strict";

const fs = require("fs");
const path = require("path");

const { validateEvent, validateRunIndex } = require("./schemas/event-schema");
const { discoverRuns } = require("./lib/artifact-discovery");
const { parseRun } = require("./lib/run-parser");
const { emitEvents } = require("./lib/event-emitter");
const { indexRun } = require("./lib/run-indexer");
const { aggregate } = require("./lib/aggregator");

function resolveDefaultRunsDir() {
  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (localAppData) {
    const appDataRunsDir = path.join(localAppData, "SteveApp", "run-artifacts");
    if (fs.existsSync(appDataRunsDir)) {
      return appDataRunsDir;
    }
  }

  return path.resolve(__dirname, "..", "runs");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let runsDir = resolveDefaultRunsDir();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--runs-dir") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --runs-dir");
      }

      runsDir = path.resolve(process.cwd(), nextValue);
      index++;
      continue;
    }

    if (arg === "--help") {
      process.stdout.write("Usage: node diagnostics/analyze.js [--runs-dir <path>]\n");
      process.stdout.write("Default runs dir: %LOCALAPPDATA%\\SteveApp\\run-artifacts when present, else <repo>\\runs\n");
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { runsDir };
}

function writeJsonLines(filePath, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, body ? `${body}\n` : "", "utf-8");
}

function main(argv) {
  const { runsDir } = parseArgs(argv);
  const outputDir = path.join(__dirname, "output");

  fs.mkdirSync(outputDir, { recursive: true });

  const runPaths = discoverRuns(runsDir);
  const allEvents = [];
  const runIndexes = [];
  const warnings = [];

  for (const runPath of runPaths) {
    const parsedRun = parseRun(runPath);
    warnings.push(...parsedRun.warnings);

    if (!parsedRun.run) {
      continue;
    }

    const events = emitEvents(parsedRun);
    const runIndex = indexRun(parsedRun, events);

    for (const event of events) {
      if (!validateEvent(event)) {
        throw new Error(`Invalid event emitted for ${parsedRun.run.run_id}: ${JSON.stringify(event)}`);
      }
    }

    if (!validateRunIndex(runIndex)) {
      throw new Error(`Invalid run index emitted for ${parsedRun.run.run_id}: ${JSON.stringify(runIndex)}`);
    }

    allEvents.push(...events);
    runIndexes.push(runIndex);
  }

  const summary = aggregate(runIndexes, allEvents);

  writeJsonLines(path.join(outputDir, "events.jsonl"), allEvents);
  writeJsonLines(path.join(outputDir, "runs_index.jsonl"), runIndexes);
  fs.writeFileSync(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf-8"
  );

  for (const warning of warnings) {
    process.stderr.write(`[diagnostics] ${warning}\n`);
  }
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { main };
