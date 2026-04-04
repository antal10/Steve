"use strict";

const { isDeliberationFallback, isMinutesFallback } = require("./heuristics");
const { assignSignature } = require("./signatures");

const INFERRED_EVENT_TYPES = new Set([
  "response_missing",
  "deliberation_reply_empty",
  "minutes_fallback",
]);
const EXPECTED_PIPELINE_STAGES = new Set([
  "broadcast",
  "collect",
  "deliberation",
  "minutes",
]);

function unwrapRun(parsedRun) {
  return parsedRun && parsedRun.run ? parsedRun.run : parsedRun;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAgent(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "@unknown";
  }

  return text.startsWith("@") ? text : `@${text}`;
}

function normalizeCompletedStage(stage) {
  switch (stage) {
    case "deliberate":
      return "deliberation";
    default:
      return String(stage || "").trim();
  }
}

function deriveRunCompletionOutcome(run) {
  if (run.status === "failed") {
    return "failed";
  }

  if (run.status === "partial") {
    return "partial";
  }

  if (run.status === "completed") {
    return "completed";
  }

  const completedStages = new Set(
    asArray(run.stages_completed)
      .map(normalizeCompletedStage)
      .filter(Boolean)
  );

  return completedStages.size < EXPECTED_PIPELINE_STAGES.size
    ? "partial"
    : "completed";
}

function pickTimestamp() {
  for (const candidate of arguments) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return "";
}

function sortByTimestamp(items, idKey) {
  return items.slice().sort((left, right) => {
    const leftTimestamp = pickTimestamp(left.timestamp);
    const rightTimestamp = pickTimestamp(right.timestamp);
    return leftTimestamp.localeCompare(rightTimestamp)
      || String(left[idKey] || "").localeCompare(String(right[idKey] || ""));
  });
}

function mapFailureStage(stage) {
  switch (stage) {
    case "broadcast":
      return "broadcast";
    case "collect":
    case "opening":
      return "collect";
    case "deliberate":
    case "deliberation":
      return "deliberation";
    case "minutes":
      return "minutes";
    default:
      return "run";
  }
}

function buildRequestedAgents(run) {
  const openingDispatches = sortByTimestamp(
    asArray(run.prompt_dispatches).filter((dispatch) => dispatch.stage === "opening"),
    "dispatch_id"
  );

  if (openingDispatches.length > 0) {
    const seen = new Set();
    const requested = [];

    for (const dispatch of openingDispatches) {
      const agent = normalizeAgent(dispatch.agent);
      if (seen.has(agent)) {
        continue;
      }

      seen.add(agent);
      requested.push({
        agent,
        timestamp: pickTimestamp(dispatch.timestamp, run.timestamp),
        dispatch,
      });
    }

    return requested;
  }

  return asArray(run.agents_active).map((agent) => ({
    agent: normalizeAgent(agent),
    timestamp: pickTimestamp(run.timestamp),
    dispatch: null,
  }));
}

function buildOpeningPostMap(run) {
  const posts = sortByTimestamp(
    asArray(run.posts).filter((post) => post.stage === "opening"),
    "post_id"
  );
  const byAgent = new Map();

  for (const post of posts) {
    const agent = normalizeAgent(post.author);
    if (!byAgent.has(agent)) {
      byAgent.set(agent, post);
    }
  }

  return byAgent;
}

function buildMinutesPost(run) {
  const minutesPosts = sortByTimestamp(
    asArray(run.posts).filter((post) => post.stage === "minutes"),
    "post_id"
  );

  const sourcePostId = run.minutes && typeof run.minutes.source_post_id === "string"
    ? run.minutes.source_post_id
    : "";

  if (sourcePostId) {
    const exactMatch = minutesPosts.find((post) => post.post_id === sourcePostId);
    if (exactMatch) {
      return exactMatch;
    }
  }

  return minutesPosts[0] || null;
}

function buildDeliberationFallbacks(run, agentsWithFallbackPosts) {
  const fallbackEvents = [];
  const agentStatuses = run.agent_statuses || {};

  for (const key of Object.keys(agentStatuses)) {
    const record = agentStatuses[key];
    const deliberation = record && typeof record === "object" ? record.deliberation : null;
    if (!deliberation || typeof deliberation !== "object") {
      continue;
    }

    const agent = normalizeAgent(record.handle || key);
    if (agentsWithFallbackPosts.has(agent)) {
      continue;
    }

    const postIds = asArray(deliberation.post_ids);
    const rawResponseText = deliberation.raw_response_text;
    if (postIds.length > 0 || !isDeliberationFallback(rawResponseText)) {
      continue;
    }

    fallbackEvents.push({
      agent,
      timestamp: pickTimestamp(
        deliberation.completed_at,
        deliberation.started_at,
        run.stage_timestamps && run.stage_timestamps.deliberate && run.stage_timestamps.deliberate.completed_at,
        run.timestamp
      ),
      detail: {
        missing_targets: asArray(deliberation.missing_targets).map(normalizeAgent),
        source_dispatch_id: deliberation.source_dispatch_id || null,
      },
      artifact_ref: {
        path: run.artifact_path,
        source_dispatch_id: deliberation.source_dispatch_id || null,
      },
      message: `Deliberation response from ${agent} contained no explicit reply targets.`,
    });
  }

  return sortByTimestamp(fallbackEvents, "agent");
}

function createEventFactory(run) {
  let sequence = 1;

  return function createEvent(event) {
    const seq = sequence++;
    const confidence = INFERRED_EVENT_TYPES.has(event.event_type)
      ? "inferred"
      : "authoritative";

    return {
      event_id: `evt_${run.run_id}_${String(seq).padStart(4, "0")}`,
      run_id: run.run_id,
      timestamp: pickTimestamp(event.timestamp, run.timestamp),
      seq,
      agent: event.agent || "@system",
      stage: event.stage,
      event_type: event.event_type,
      outcome: event.outcome,
      signature: assignSignature(event.stage, event.outcome, event.event_type),
      message: event.message || "",
      detail: event.detail === undefined ? null : event.detail,
      artifact_ref: event.artifact_ref === undefined ? null : event.artifact_ref,
      source: "artifact",
      confidence,
    };
  };
}

function emitFailureEvents(run, createEvent, stage) {
  return sortByTimestamp(
    asArray(run.failures)
      .filter((failure) => mapFailureStage(failure.stage) === stage)
      .map((failure, index) => ({
        failure,
        index,
        id: `${index}`,
        timestamp: pickTimestamp(failure.timestamp, run.timestamp),
      })),
    "id"
  ).map((item) => createEvent({
    timestamp: item.timestamp,
    agent: normalizeAgent(item.failure.agent),
    stage,
    event_type: "failure_recorded",
    outcome: "failed",
    message: String(item.failure.message || `${stage} failure recorded.`),
    detail: {
      phase: item.failure.phase || null,
    },
    artifact_ref: {
      path: run.artifact_path,
      failure_index: item.index,
    },
  }));
}

function emitEvents(parsedRun) {
  const run = unwrapRun(parsedRun);
  if (!run) {
    return [];
  }

  const createEvent = createEventFactory(run);
  const events = [];
  const requestedAgents = buildRequestedAgents(run);
  const openingPostsByAgent = buildOpeningPostMap(run);
  const runCompletionOutcome = deriveRunCompletionOutcome(run);

  events.push(createEvent({
    timestamp: run.timestamp,
    agent: "@system",
    stage: "run",
    event_type: "run_started",
    outcome: "started",
    message: `Run ${run.run_id} loaded from artifact.`,
    detail: {
      status: run.status,
      artifact_path: run.artifact_path,
    },
    artifact_ref: {
      path: run.artifact_path,
    },
  }));

  for (const requested of requestedAgents) {
    events.push(createEvent({
      timestamp: requested.timestamp,
      agent: requested.agent,
      stage: "broadcast",
      event_type: "agent_requested",
      outcome: "requested",
      message: `Opening prompt requested for ${requested.agent}.`,
      detail: {
        dispatch_id: requested.dispatch ? requested.dispatch.dispatch_id || null : null,
      },
      artifact_ref: {
        path: run.artifact_path,
        dispatch_id: requested.dispatch ? requested.dispatch.dispatch_id || null : null,
      },
    }));
  }

  events.push(...emitFailureEvents(run, createEvent, "broadcast"));

  for (const requested of requestedAgents) {
    const post = openingPostsByAgent.get(requested.agent);
    if (post) {
      events.push(createEvent({
        timestamp: pickTimestamp(
          post.timestamp,
          run.stage_timestamps && run.stage_timestamps.collect && run.stage_timestamps.collect.completed_at,
          run.timestamp
        ),
        agent: requested.agent,
        stage: "collect",
        event_type: "response_collected",
        outcome: post.capture_status === "partial" ? "partial" : "completed",
        message: `Opening response captured from ${requested.agent}.`,
        detail: {
          post_id: post.post_id || null,
          capture_status: post.capture_status || null,
          word_count: post.word_count || 0,
        },
        artifact_ref: {
          path: run.artifact_path,
          post_id: post.post_id || null,
          dispatch_id: post.source_dispatch_id || null,
        },
      }));
      continue;
    }

    events.push(createEvent({
      timestamp: pickTimestamp(
        run.stage_timestamps && run.stage_timestamps.collect && run.stage_timestamps.collect.completed_at,
        run.stage_timestamps && run.stage_timestamps.collect && run.stage_timestamps.collect.started_at,
        requested.timestamp,
        run.timestamp
      ),
      agent: requested.agent,
      stage: "collect",
      event_type: "response_missing",
      outcome: "missing",
      message: `No opening response was captured for ${requested.agent}.`,
      detail: {
        dispatch_id: requested.dispatch ? requested.dispatch.dispatch_id || null : null,
      },
      artifact_ref: {
        path: run.artifact_path,
        dispatch_id: requested.dispatch ? requested.dispatch.dispatch_id || null : null,
      },
    }));
  }

  events.push(...emitFailureEvents(run, createEvent, "collect"));

  const deliberationStage = run.stage_timestamps && run.stage_timestamps.deliberate;
  const deliberationPosts = sortByTimestamp(
    asArray(run.posts).filter((post) => post.stage === "deliberation"),
    "post_id"
  );
  const agentsWithFallbackPosts = new Set();

  if (deliberationStage && deliberationStage.status === "skipped" && deliberationPosts.length === 0) {
    events.push(createEvent({
      timestamp: pickTimestamp(deliberationStage.completed_at, deliberationStage.started_at, run.timestamp),
      agent: "@system",
      stage: "deliberation",
      event_type: "deliberation_skipped",
      outcome: "skipped",
      message: String(deliberationStage.message || "Deliberation was skipped."),
      detail: null,
      artifact_ref: {
        path: run.artifact_path,
      },
    }));
  } else {
    for (const post of deliberationPosts) {
      const isFallback = isDeliberationFallback(post.content || post.raw_content);
      if (isFallback) {
        agentsWithFallbackPosts.add(normalizeAgent(post.author));
      }

      events.push(createEvent({
        timestamp: pickTimestamp(post.timestamp, run.timestamp),
        agent: normalizeAgent(post.author),
        stage: "deliberation",
        event_type: isFallback ? "deliberation_reply_empty" : "deliberation_reply_recorded",
        outcome: isFallback ? "missing" : (post.capture_status === "partial" ? "partial" : "completed"),
        message: isFallback
          ? `Deliberation reply placeholder captured for ${normalizeAgent(post.author)}.`
          : `Deliberation reply captured from ${normalizeAgent(post.author)} to ${normalizeAgent(post.reply_to)}.`,
        detail: {
          post_id: post.post_id || null,
          reply_to: post.reply_to ? normalizeAgent(post.reply_to) : null,
          capture_status: post.capture_status || null,
        },
        artifact_ref: {
          path: run.artifact_path,
          post_id: post.post_id || null,
          dispatch_id: post.source_dispatch_id || null,
        },
      }));
    }

    for (const fallback of buildDeliberationFallbacks(run, agentsWithFallbackPosts)) {
      events.push(createEvent({
        timestamp: fallback.timestamp,
        agent: fallback.agent,
        stage: "deliberation",
        event_type: "deliberation_reply_empty",
        outcome: "missing",
        message: fallback.message,
        detail: fallback.detail,
        artifact_ref: fallback.artifact_ref,
      }));
    }
  }

  events.push(...emitFailureEvents(run, createEvent, "deliberation"));

  const minutesStage = run.stage_timestamps && run.stage_timestamps.minutes;
  const minutesPost = buildMinutesPost(run);
  const minutesAgent = normalizeAgent(
    (run.minutes && run.minutes.generated_by)
    || (minutesPost && minutesPost.author)
    || "@system"
  );

  if (
    (minutesStage && minutesStage.status === "skipped")
    || (run.minutes && run.minutes.status === "skipped")
  ) {
    events.push(createEvent({
      timestamp: pickTimestamp(
        minutesStage && minutesStage.completed_at,
        minutesStage && minutesStage.started_at,
        run.timestamp
      ),
      agent: "@system",
      stage: "minutes",
      event_type: "minutes_skipped",
      outcome: "skipped",
      message: String(
        (run.minutes && run.minutes.reason)
        || (minutesStage && minutesStage.message)
        || "Minutes were skipped."
      ),
      detail: null,
      artifact_ref: {
        path: run.artifact_path,
      },
    }));
  } else if (run.minutes && isMinutesFallback(run.minutes)) {
    events.push(createEvent({
      timestamp: pickTimestamp(
        minutesPost && minutesPost.timestamp,
        run.minutes.timestamp,
        minutesStage && minutesStage.completed_at,
        run.timestamp
      ),
      agent: minutesAgent,
      stage: "minutes",
      event_type: "minutes_fallback",
      outcome: run.minutes.status === "failed" ? "failed" : "partial",
      message: "Minutes fallback detected from artifact content.",
      detail: {
        parse_status: run.minutes.parse_status || null,
        source_post_id: run.minutes.source_post_id || (minutesPost && minutesPost.post_id) || null,
      },
      artifact_ref: {
        path: run.artifact_path,
        post_id: run.minutes.source_post_id || (minutesPost && minutesPost.post_id) || null,
        dispatch_id: run.minutes.source_dispatch_id || (minutesPost && minutesPost.source_dispatch_id) || null,
      },
    }));
  } else if (run.minutes && (Object.keys(run.minutes).length > 0 || minutesPost)) {
    events.push(createEvent({
      timestamp: pickTimestamp(
        minutesPost && minutesPost.timestamp,
        minutesStage && minutesStage.completed_at,
        run.timestamp
      ),
      agent: minutesAgent,
      stage: "minutes",
      event_type: "minutes_recorded",
      outcome: run.minutes.status === "partial" ? "partial" : "completed",
      message: `Minutes recorded by ${minutesAgent}.`,
      detail: {
        consensus_level: run.minutes.consensus_level || null,
        parse_status: run.minutes.parse_status || null,
        source_post_id: run.minutes.source_post_id || (minutesPost && minutesPost.post_id) || null,
      },
      artifact_ref: {
        path: run.artifact_path,
        post_id: run.minutes.source_post_id || (minutesPost && minutesPost.post_id) || null,
        dispatch_id: run.minutes.source_dispatch_id || (minutesPost && minutesPost.source_dispatch_id) || null,
      },
    }));
  }

  events.push(...emitFailureEvents(run, createEvent, "minutes"));

  events.push(createEvent({
    timestamp: pickTimestamp(
      minutesStage && minutesStage.completed_at,
      run.timestamp
    ),
    agent: "@system",
    stage: "run",
    event_type: "run_completed",
    outcome: runCompletionOutcome,
    message: `Run ${run.run_id} completed with status ${runCompletionOutcome}.`,
    detail: {
      duration_seconds: run.duration_seconds,
      failure_count: asArray(run.failures).length,
    },
    artifact_ref: {
      path: run.artifact_path,
    },
  }));

  return events;
}

module.exports = { emitEvents };
