"use strict";

const fs = require("fs");
const path = require("path");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asObject(value) {
  return isPlainObject(value) ? value : {};
}

function asObjectArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPlainObject);
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function parseRun(filePath) {
  const resolvedPath = path.resolve(filePath);
  const warnings = [];

  let rawText = "";
  try {
    rawText = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    warnings.push(`Unable to read ${resolvedPath}: ${error.message}`);
    return { run: null, warnings };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    warnings.push(`Unable to parse ${resolvedPath}: ${error.message}`);
    return { run: null, warnings };
  }

  if (!isPlainObject(parsed)) {
    warnings.push(`Ignoring ${resolvedPath}: top-level JSON value must be an object.`);
    return { run: null, warnings };
  }

  const normalizedRun = {
    run_id: String(parsed.run_id || path.basename(resolvedPath, path.extname(resolvedPath))),
    status: typeof parsed.status === "string" ? parsed.status : "unknown",
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
    prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
    agents_active: asStringArray(parsed.agents_active),
    stages_completed: asStringArray(parsed.stages_completed),
    stage_timestamps: asObject(parsed.stage_timestamps),
    duration_seconds: Number.isFinite(parsed.duration_seconds) ? parsed.duration_seconds : null,
    prompt_dispatches: asObjectArray(parsed.prompt_dispatches),
    posts: asObjectArray(parsed.posts),
    minutes: asObject(parsed.minutes),
    failures: asObjectArray(parsed.failures),
    agent_statuses: asObject(parsed.agent_statuses),
    deliberation: asObject(parsed.deliberation),
    artifact_path: resolvedPath,
  };

  if (!Array.isArray(parsed.stages_completed)) {
    warnings.push(`Normalized missing or invalid stages_completed in ${resolvedPath}.`);
  }

  if (!isPlainObject(parsed.minutes)) {
    warnings.push(`Normalized missing or invalid minutes object in ${resolvedPath}.`);
  }

  return { run: normalizedRun, warnings };
}

module.exports = { parseRun };
