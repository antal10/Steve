const fs = require("fs");
const path = require("path");

const { buildArtifactPath, writeArtifact } = require("./artifact-writer");
const { appendRunEvent } = require("./event-log");
const { writeMatrices } = require("./matrix-writer");
const { assertPathInsideUserDataRoot } = require("../runtime/runtime-paths");

const MIRROR_SCHEMA_VERSION = 1;

function isInsidePath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeRunId(runId) {
  const value = String(runId || "").trim();
  if (!value) {
    throw new Error("Missing artifact mirror run_id.");
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(value) || value.includes("..")) {
    throw new Error(`Unsafe artifact mirror run_id "${runId}".`);
  }

  return value;
}

function assertInsideRoot(rootDir, candidatePath, label) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (!isInsidePath(resolvedRoot, resolvedCandidate)) {
    throw new Error(`Unsafe ${label} "${resolvedCandidate}".`);
  }

  return resolvedCandidate;
}

function removeDirectoryInsideRoot(rootDir, targetDir) {
  const resolvedTarget = assertInsideRoot(rootDir, targetDir, "artifact mirror cleanup directory");
  if (path.resolve(rootDir) === resolvedTarget) {
    throw new Error("Refusing to remove artifact mirror root.");
  }

  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

function normalizeHandle(handle) {
  const value = String(handle || "").trim();
  return value.startsWith("@") ? value : `@${value}`;
}

function roundForStage(stage) {
  return stage === "deliberation" ? 1 : 0;
}

function writeJsonArtifact(rootDir, artifactPath, value) {
  return writeArtifact({
    rootDir,
    artifactPath,
    content: `${JSON.stringify(value, null, 2)}\n`,
  });
}

function buildPromptPacket(runData, runId, sourceJsonFilename) {
  return {
    schema_version: MIRROR_SCHEMA_VERSION,
    packet_type: "steve.v1.prompt_packet",
    run_id: runId,
    source_json: sourceJsonFilename,
    prompt_sha256: runData.prompt_sha256 || null,
    prompt_byte_length: Buffer.byteLength(String(runData.prompt || ""), "utf-8"),
    agents_active: runData.agents_active || [],
    prompt: runData.prompt || "",
  };
}

function buildDeviationReport(runData, runId, sourceJsonFilename) {
  const stageStatuses = {};
  for (const [stage, record] of Object.entries(runData.stage_timestamps || {})) {
    stageStatuses[stage] = record?.status || null;
  }

  return {
    schema_version: MIRROR_SCHEMA_VERSION,
    report_type: "steve.v1.deviation_report",
    run_id: runId,
    source_json: sourceJsonFilename,
    run_status: runData.status || null,
    stage_statuses: stageStatuses,
    failures: runData.failures || [],
    deliberation: {
      expected_reply_count: runData.deliberation?.expected_reply_count || 0,
      actual_reply_count: runData.deliberation?.actual_reply_count || 0,
      missing_pairs: runData.deliberation?.missing_pairs || [],
    },
  };
}

function buildMinutesArtifact(runData, runId, sourceJsonFilename) {
  return {
    schema_version: MIRROR_SCHEMA_VERSION,
    artifact_type: "steve.v1.minutes",
    run_id: runId,
    source_json: sourceJsonFilename,
    minutes: runData.minutes || {},
  };
}

function indexDispatches(runData) {
  const dispatchesById = new Map();
  for (const dispatch of runData.prompt_dispatches || []) {
    dispatchesById.set(dispatch.dispatch_id, dispatch);
  }

  return dispatchesById;
}

function getPromptHashForPost(post, dispatchesById, fallbackPromptHash) {
  const dispatch = dispatchesById.get(post.source_dispatch_id);
  return dispatch?.sent_prompt_sha256 || dispatch?.original_prompt_sha256 || fallbackPromptHash || null;
}

function createStagingDir(runsDir, runId) {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stagingDir = path.join(runsDir, `${runId}.artifact-tmp-${suffix}`);
  assertInsideRoot(runsDir, stagingDir, "artifact mirror staging directory");
  fs.mkdirSync(stagingDir, { recursive: true });
  return stagingDir;
}

function mirrorRunArtifacts(runData, { runsDir, runId, sourceJsonFilename } = {}) {
  if (!runsDir) {
    throw new Error("Missing run artifact root.");
  }

  const resolvedRunsDir = assertPathInsideUserDataRoot(
    path.resolve(runsDir),
    "run artifact root"
  );
  const safeRunId = assertSafeRunId(runId || runData.run_id);
  const jsonFilename = sourceJsonFilename || `${safeRunId}.json`;
  const finalDir = assertInsideRoot(resolvedRunsDir, path.join(resolvedRunsDir, safeRunId), "artifact mirror directory");

  if (fs.existsSync(finalDir)) {
    throw new Error(`Artifact mirror already exists for run_id "${safeRunId}".`);
  }

  const stagingDir = createStagingDir(resolvedRunsDir, safeRunId);
  const dispatchesById = indexDispatches(runData);
  const promptHash = runData.prompt_sha256 || null;
  const artifactsByPostId = {};
  let eventCount = 0;

  try {
    const promptPacketArtifact = writeJsonArtifact(
      stagingDir,
      "prompt_packet.json",
      buildPromptPacket(runData, safeRunId, jsonFilename)
    );
    appendRunEvent(stagingDir, {
      run_id: safeRunId,
      timestamp: runData.timestamp,
      stage: "broadcast",
      round: 0,
      agent: "user",
      type: "prompt_packet",
      status: "written",
      artifact_path: promptPacketArtifact.artifact_path,
      prompt_hash: promptPacketArtifact.sha256,
      response_hash: null,
    });
    eventCount++;

    for (const dispatch of runData.prompt_dispatches || []) {
      const artifact = writeArtifact({
        rootDir: stagingDir,
        artifactPath: buildArtifactPath({
          stage: "packets",
          round: dispatch.round,
          agent: dispatch.agent,
          type: dispatch.stage,
          id: dispatch.dispatch_id,
          extension: "md",
        }),
        content: dispatch.sent_prompt_text || dispatch.original_prompt_text || "",
      });

      appendRunEvent(stagingDir, {
        run_id: safeRunId,
        timestamp: dispatch.timestamp,
        stage: dispatch.stage,
        round: dispatch.round,
        agent: dispatch.agent,
        type: "round_packet",
        status: dispatch.status,
        artifact_path: artifact.artifact_path,
        prompt_hash: artifact.sha256,
        response_hash: null,
        dispatch_id: dispatch.dispatch_id,
      });
      eventCount++;
    }

    for (const post of runData.posts || []) {
      const artifact = writeArtifact({
        rootDir: stagingDir,
        artifactPath: buildArtifactPath({
          stage: "posts",
          round: roundForStage(post.stage),
          agent: post.author,
          type: post.stage,
          id: post.post_id,
          extension: "md",
        }),
        content: post.raw_content || post.content || "",
      });
      artifactsByPostId[post.post_id] = artifact;

      appendRunEvent(stagingDir, {
        run_id: safeRunId,
        timestamp: post.timestamp,
        stage: post.stage,
        round: roundForStage(post.stage),
        agent: normalizeHandle(post.author),
        type: post.type,
        status: post.capture_status,
        artifact_path: artifact.artifact_path,
        prompt_hash: getPromptHashForPost(post, dispatchesById, promptHash),
        response_hash: artifact.sha256,
        post_id: post.post_id,
        source_dispatch_id: post.source_dispatch_id,
      });
      eventCount++;
    }

    writeMatrices(path.join(stagingDir, "matrices"), {
      posts: runData.posts || [],
      artifactsByPostId,
      agents: runData.agents_active || [],
    });

    writeJsonArtifact(stagingDir, "minutes.json", buildMinutesArtifact(runData, safeRunId, jsonFilename));
    writeJsonArtifact(stagingDir, "deviation_report.json", buildDeviationReport(runData, safeRunId, jsonFilename));

    fs.renameSync(stagingDir, finalDir);

    return {
      run_id: safeRunId,
      folder: safeRunId,
      path: finalDir,
      event_count: eventCount,
      schema_version: MIRROR_SCHEMA_VERSION,
    };
  } catch (err) {
    removeDirectoryInsideRoot(resolvedRunsDir, stagingDir);
    throw err;
  }
}

module.exports = {
  MIRROR_SCHEMA_VERSION,
  assertSafeRunId,
  mirrorRunArtifacts,
};
