const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OPENING_HEADERS = [
  "post_id",
  "agent",
  "stage",
  "type",
  "status",
  "timestamp",
  "response_hash",
  "artifact_path",
  "byte_length",
  "word_count",
];

const CROSS_REPLY_HEADERS = [
  "post_id",
  "from_agent",
  "to_agent",
  "stage",
  "type",
  "status",
  "timestamp",
  "response_hash",
  "artifact_path",
  "byte_length",
  "word_count",
];

const RECEPTION_HEADERS = [
  "target_agent",
  "expected_replies",
  "received_replies",
  "missing_from",
];

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function writeCsvFile(outputDir, filename, headers, rows) {
  const resolvedDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];

  const targetPath = path.join(resolvedDir, filename);
  fs.writeFileSync(targetPath, `${lines.join("\n")}\n`, "utf-8");

  return {
    filename,
    path: targetPath,
    row_count: rows.length,
  };
}

function normalizeHandle(handle) {
  const value = String(handle || "").trim();
  if (!value) {
    return "";
  }

  return value.startsWith("@") ? value : `@${value}`;
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf-8").digest("hex");
}

function indexArtifacts(artifactsByPostId) {
  if (!artifactsByPostId) {
    return new Map();
  }

  if (artifactsByPostId instanceof Map) {
    return artifactsByPostId;
  }

  if (Array.isArray(artifactsByPostId)) {
    return new Map(
      artifactsByPostId
        .filter((artifact) => artifact && artifact.post_id)
        .map((artifact) => [artifact.post_id, artifact])
    );
  }

  return new Map(Object.entries(artifactsByPostId));
}

function getPostArtifact(post, artifactIndex) {
  const artifact = artifactIndex.get(post.post_id) || post.artifact || {};
  const content = post.raw_content ?? post.content;

  return {
    artifact_path: artifact.artifact_path || post.artifact_path || "",
    response_hash: artifact.response_hash || artifact.sha256 || post.response_hash || post.content_sha256 || (content ? hashText(content) : ""),
    byte_length: artifact.byte_length ?? post.byte_length ?? "",
  };
}

function uniqueHandles(handles) {
  const seen = new Set();
  const result = [];

  for (const handle of handles.map(normalizeHandle).filter(Boolean)) {
    if (!seen.has(handle)) {
      seen.add(handle);
      result.push(handle);
    }
  }

  return result;
}

function deriveAgents(posts, explicitAgents) {
  if (explicitAgents && explicitAgents.length) {
    return uniqueHandles(explicitAgents);
  }

  return uniqueHandles(
    posts.flatMap((post) => [post.author, post.reply_to]).filter(Boolean)
  );
}

function writeOpeningMatrix(outputDir, { posts = [], artifactsByPostId, agents } = {}) {
  const artifactIndex = indexArtifacts(artifactsByPostId);
  const openings = posts.filter((post) => post.stage === "opening");
  const openingByAgent = new Map(openings.map((post) => [normalizeHandle(post.author), post]));
  const matrixAgents = deriveAgents(openings, agents);

  const rows = matrixAgents.map((agent) => {
    const post = openingByAgent.get(agent);
    if (!post) {
      return {
        post_id: "",
        agent,
        stage: "opening",
        type: "statement",
        status: "missing",
        timestamp: "",
        response_hash: "",
        artifact_path: "",
        byte_length: "",
        word_count: "",
      };
    }

    const artifact = getPostArtifact(post, artifactIndex);
    return {
      post_id: post.post_id || "",
      agent,
      stage: post.stage || "opening",
      type: post.type || "statement",
      status: post.capture_status || "present",
      timestamp: post.timestamp || "",
      response_hash: artifact.response_hash,
      artifact_path: artifact.artifact_path,
      byte_length: artifact.byte_length,
      word_count: post.word_count ?? "",
    };
  });

  return writeCsvFile(outputDir, "opening_matrix.csv", OPENING_HEADERS, rows);
}

function buildReplyIndex(posts) {
  const index = new Map();
  for (const post of posts.filter((candidate) => candidate.stage === "deliberation")) {
    const key = `${normalizeHandle(post.author)}->${normalizeHandle(post.reply_to)}`;
    if (!index.has(key)) {
      index.set(key, post);
    }
  }

  return index;
}

function writeCrossReplyMatrix(outputDir, { posts = [], artifactsByPostId, agents } = {}) {
  const artifactIndex = indexArtifacts(artifactsByPostId);
  const matrixAgents = deriveAgents(posts, agents);
  const replyIndex = buildReplyIndex(posts);
  const rows = [];

  for (const fromAgent of matrixAgents) {
    for (const toAgent of matrixAgents) {
      if (fromAgent === toAgent) {
        continue;
      }

      const post = replyIndex.get(`${fromAgent}->${toAgent}`);
      if (!post) {
        rows.push({
          post_id: "",
          from_agent: fromAgent,
          to_agent: toAgent,
          stage: "deliberation",
          type: "reply",
          status: "missing",
          timestamp: "",
          response_hash: "",
          artifact_path: "",
          byte_length: "",
          word_count: "",
        });
        continue;
      }

      const artifact = getPostArtifact(post, artifactIndex);
      rows.push({
        post_id: post.post_id || "",
        from_agent: fromAgent,
        to_agent: toAgent,
        stage: post.stage || "deliberation",
        type: post.type || "reply",
        status: post.capture_status || "present",
        timestamp: post.timestamp || "",
        response_hash: artifact.response_hash,
        artifact_path: artifact.artifact_path,
        byte_length: artifact.byte_length,
        word_count: post.word_count ?? "",
      });
    }
  }

  return writeCsvFile(outputDir, "cross_reply_matrix.csv", CROSS_REPLY_HEADERS, rows);
}

function writeReceptionMatrix(outputDir, { posts = [], agents } = {}) {
  const matrixAgents = deriveAgents(posts, agents);
  const replyIndex = buildReplyIndex(posts);
  const rows = matrixAgents.map((targetAgent) => {
    const expectedSenders = matrixAgents.filter((agent) => agent !== targetAgent);
    const receivedFrom = expectedSenders.filter((sender) => replyIndex.has(`${sender}->${targetAgent}`));
    const missingFrom = expectedSenders.filter((sender) => !replyIndex.has(`${sender}->${targetAgent}`));

    return {
      target_agent: targetAgent,
      expected_replies: expectedSenders.length,
      received_replies: receivedFrom.length,
      missing_from: missingFrom.join(";"),
    };
  });

  return writeCsvFile(outputDir, "reception_matrix.csv", RECEPTION_HEADERS, rows);
}

function writeMatrices(outputDir, data = {}) {
  return {
    opening_matrix: writeOpeningMatrix(outputDir, data),
    cross_reply_matrix: writeCrossReplyMatrix(outputDir, data),
    reception_matrix: writeReceptionMatrix(outputDir, data),
  };
}

module.exports = {
  CROSS_REPLY_HEADERS,
  OPENING_HEADERS,
  RECEPTION_HEADERS,
  csvEscape,
  writeCrossReplyMatrix,
  writeMatrices,
  writeOpeningMatrix,
  writeReceptionMatrix,
};
