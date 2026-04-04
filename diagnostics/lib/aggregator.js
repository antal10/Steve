"use strict";

const ANALYZER_VERSION = "diagnostics-analyzer/0.1.0";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isFailureEvent(event) {
  return event.event_type === "response_missing"
    || event.event_type === "deliberation_reply_empty"
    || event.event_type === "minutes_fallback"
    || event.event_type === "failure_recorded";
}

function isInferredFailureEvent(event) {
  return event.confidence === "inferred" && isFailureEvent(event);
}

function isDiagnosticEvent(event) {
  return isFailureEvent(event)
    || event.outcome === "partial"
    || event.outcome === "failed"
    || event.outcome === "missing"
    || event.outcome === "skipped";
}

function normalizeStageName(stage) {
  switch (stage) {
    case "deliberate":
      return "deliberation";
    default:
      return stage;
  }
}

function createPerAgentStats() {
  return {
    requested: 0,
    responded: 0,
    failed_inferred: 0,
    failure_count: 0,
    event_count: 0,
  };
}

function isStageCompleted(index, stage) {
  const stageStatuses = index.stage_statuses && typeof index.stage_statuses === "object"
    ? index.stage_statuses
    : null;
  const explicitStatus = stageStatuses ? stageStatuses[stage] : undefined;

  if (explicitStatus !== null && explicitStatus !== undefined) {
    return explicitStatus === "completed";
  }

  const normalizedStages = new Set(asArray(index.stages_completed).map(normalizeStageName));
  return normalizedStages.has(stage);
}

function aggregate(runIndexes, allEvents) {
  const indexes = asArray(runIndexes);
  const events = asArray(allEvents);

  const timestamps = indexes
    .map((index) => index.timestamp)
    .filter((timestamp) => typeof timestamp === "string" && timestamp);
  const sortedTimestamps = timestamps.slice().sort();

  const perAgentStats = {};
  for (const event of events) {
    if (typeof event.agent !== "string" || event.agent === "@system") {
      continue;
    }

    if (!perAgentStats[event.agent]) {
      perAgentStats[event.agent] = createPerAgentStats();
    }

    const stats = perAgentStats[event.agent];
    stats.event_count++;

    if (event.event_type === "agent_requested") {
      stats.requested++;
    }

    if (event.event_type === "response_collected") {
      stats.responded++;
    }

    if (isFailureEvent(event)) {
      stats.failure_count++;
    }

    if (isInferredFailureEvent(event)) {
      stats.failed_inferred++;
    }
  }

  const signatureCounts = new Map();
  for (const event of events) {
    if (!isDiagnosticEvent(event)) {
      continue;
    }

    signatureCounts.set(event.signature, (signatureCounts.get(event.signature) || 0) + 1);
  }

  const topSignatures = Array.from(signatureCounts.entries())
    .map(([signature, count]) => ({ signature, count }))
    .sort((left, right) => right.count - left.count || left.signature.localeCompare(right.signature))
    .slice(0, 10);

  const stageKeys = ["broadcast", "collect", "deliberation", "minutes"];
  const stageCompletionRates = {};
  for (const stage of stageKeys) {
    let completedRuns = 0;

    for (const index of indexes) {
      if (isStageCompleted(index, stage)) {
        completedRuns++;
      }
    }

    stageCompletionRates[stage] = {
      completed_runs: completedRuns,
      total_runs: indexes.length,
      completion_rate: indexes.length === 0 ? 0 : Number((completedRuns / indexes.length).toFixed(4)),
    };
  }

  const inferredFailureCountsByRun = new Map();
  for (const event of events) {
    if (!isInferredFailureEvent(event)) {
      continue;
    }

    inferredFailureCountsByRun.set(
      event.run_id,
      (inferredFailureCountsByRun.get(event.run_id) || 0) + 1
    );
  }

  const runsWithFailures = indexes
    .filter((index) => index.failure_count > 0)
    .map((index) => ({
      run_id: index.run_id,
      failure_count: index.failure_count,
      inferred_count: inferredFailureCountsByRun.get(index.run_id) || 0,
      artifact_path: index.artifact_path,
    }))
    .sort((left, right) => left.run_id.localeCompare(right.run_id));

  return {
    generated_at: sortedTimestamps[sortedTimestamps.length - 1] || null,
    analyzer_version: ANALYZER_VERSION,
    total_runs: indexes.length,
    date_range: {
      start: sortedTimestamps[0] || null,
      end: sortedTimestamps[sortedTimestamps.length - 1] || null,
    },
    total_events: events.length,
    total_failures: events.filter(isFailureEvent).length,
    per_agent_stats: perAgentStats,
    top_signatures: topSignatures,
    stage_completion_rates: stageCompletionRates,
    runs_with_failures: runsWithFailures,
  };
}

module.exports = {
  aggregate,
  ANALYZER_VERSION,
};
