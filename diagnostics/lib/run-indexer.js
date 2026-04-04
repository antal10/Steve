"use strict";

function unwrapRun(parsedRun) {
  return parsedRun && parsedRun.run ? parsedRun.run : parsedRun;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAgent(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  return text.startsWith("@") ? text : `@${text}`;
}

function orderedUniqueAgents(values) {
  const seen = new Set();
  const ordered = [];

  for (const value of values) {
    const agent = normalizeAgent(value);
    if (!agent || seen.has(agent)) {
      continue;
    }

    seen.add(agent);
    ordered.push(agent);
  }

  return ordered;
}

function buildRequestedAgents(run) {
  const openingDispatches = asArray(run.prompt_dispatches)
    .filter((dispatch) => dispatch.stage === "opening")
    .sort((left, right) => {
      return String(left.timestamp || "").localeCompare(String(right.timestamp || ""))
        || String(left.dispatch_id || "").localeCompare(String(right.dispatch_id || ""));
    });

  if (openingDispatches.length > 0) {
    return orderedUniqueAgents(openingDispatches.map((dispatch) => dispatch.agent));
  }

  return orderedUniqueAgents(run.agents_active);
}

function buildRespondedAgents(run) {
  const openingPosts = asArray(run.posts)
    .filter((post) => post.stage === "opening")
    .sort((left, right) => {
      return String(left.timestamp || "").localeCompare(String(right.timestamp || ""))
        || String(left.post_id || "").localeCompare(String(right.post_id || ""));
    });

  return orderedUniqueAgents(openingPosts.map((post) => post.author));
}

function isFailureEvent(event) {
  return event.event_type === "response_missing"
    || event.event_type === "deliberation_reply_empty"
    || event.event_type === "minutes_fallback"
    || event.event_type === "failure_recorded";
}

function collapseWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function promptPreview(prompt) {
  const collapsed = collapseWhitespace(prompt);
  if (collapsed.length <= 120) {
    return collapsed;
  }

  return `${collapsed.slice(0, 117)}...`;
}

function buildStageStatuses(run) {
  const stageTimestamps = run.stage_timestamps && typeof run.stage_timestamps === "object"
    ? run.stage_timestamps
    : {};

  return {
    broadcast: stageTimestamps.broadcast && stageTimestamps.broadcast.status || null,
    collect: stageTimestamps.collect && stageTimestamps.collect.status || null,
    deliberation: stageTimestamps.deliberate && stageTimestamps.deliberate.status || null,
    minutes: stageTimestamps.minutes && stageTimestamps.minutes.status || null,
  };
}

function indexRun(parsedRun, events) {
  const run = unwrapRun(parsedRun);
  const runEvents = asArray(events);
  const requestedAgents = buildRequestedAgents(run);
  const respondedAgents = buildRespondedAgents(run);
  const respondedSet = new Set(respondedAgents);
  const failedInferredAgents = requestedAgents.filter((agent) => !respondedSet.has(agent));

  const posts = asArray(run.posts);
  const openingPosts = posts.filter((post) => post.stage === "opening");
  const deliberationPosts = posts.filter((post) => post.stage === "deliberation");
  const minutesPosts = posts.filter((post) => post.stage === "minutes");

  return {
    run_id: run.run_id,
    timestamp: typeof run.timestamp === "string" ? run.timestamp : "",
    prompt_preview: promptPreview(run.prompt),
    agents_requested: requestedAgents,
    agents_responded: respondedAgents,
    agents_failed_inferred: failedInferredAgents,
    stages_completed: asArray(run.stages_completed).map((stage) => String(stage)),
    total_posts: posts.length,
    opening_posts: openingPosts.length,
    deliberation_posts: deliberationPosts.length,
    minutes_posts: minutesPosts.length,
    duration_seconds: Number.isFinite(run.duration_seconds) ? run.duration_seconds : null,
    minutes_agent: run.minutes && typeof run.minutes.generated_by === "string"
      ? normalizeAgent(run.minutes.generated_by)
      : null,
    consensus_level: run.minutes && typeof run.minutes.consensus_level === "string"
      ? run.minutes.consensus_level
      : null,
    event_count: runEvents.length,
    failure_count: runEvents.filter(isFailureEvent).length,
    artifact_path: run.artifact_path,
    stage_statuses: buildStageStatuses(run),
  };
}

module.exports = { indexRun };
