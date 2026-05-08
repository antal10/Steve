const fs = require("fs");
const path = require("path");

const EVENT_FIELDS = [
  "run_id",
  "timestamp",
  "stage",
  "round",
  "agent",
  "type",
  "status",
  "artifact_path",
  "prompt_hash",
  "response_hash",
];

function toIsoTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return new Date().toISOString();
}

function resolveTimestamp(event, options) {
  if (event.timestamp) {
    return toIsoTimestamp(event.timestamp);
  }

  if (options.timestamp) {
    return toIsoTimestamp(options.timestamp);
  }

  if (typeof options.now === "function") {
    return toIsoTimestamp(options.now());
  }

  return toIsoTimestamp();
}

function normalizeEvent(event = {}, options = {}) {
  const normalized = {
    run_id: event.run_id ?? null,
    timestamp: resolveTimestamp(event, options),
    stage: event.stage ?? null,
    round: event.round ?? null,
    agent: event.agent ?? null,
    type: event.type ?? null,
    status: event.status ?? null,
    artifact_path: event.artifact_path ?? null,
    prompt_hash: event.prompt_hash ?? null,
    response_hash: event.response_hash ?? null,
  };

  for (const [key, value] of Object.entries(event)) {
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function appendEvent(logFilePath, event, options = {}) {
  if (!logFilePath) {
    throw new Error("Missing event log path.");
  }

  const resolvedPath = path.resolve(logFilePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const normalized = normalizeEvent(event, options);
  fs.appendFileSync(resolvedPath, `${JSON.stringify(normalized)}\n`, "utf-8");
  return normalized;
}

function appendRunEvent(runDir, event, options = {}) {
  if (!runDir) {
    throw new Error("Missing run directory.");
  }

  return appendEvent(path.join(runDir, "events.jsonl"), event, options);
}

module.exports = {
  EVENT_FIELDS,
  appendEvent,
  appendRunEvent,
  normalizeEvent,
};
