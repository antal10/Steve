const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function toBuffer(content) {
  if (Buffer.isBuffer(content)) {
    return content;
  }

  return Buffer.from(String(content ?? ""), "utf-8");
}

function sha256Content(content) {
  return crypto.createHash("sha256").update(toBuffer(content)).digest("hex");
}

function isInsidePath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeArtifactPath(artifactPath) {
  const value = String(artifactPath || "").trim();
  if (!value) {
    throw new Error("Missing artifact path.");
  }

  if (path.isAbsolute(value)) {
    throw new Error("Artifact path must be relative.");
  }

  const normalized = path.normalize(value);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe artifact path "${artifactPath}".`);
  }

  return normalized;
}

function toPortablePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function writeArtifact({ rootDir, artifactPath, content }) {
  if (!rootDir) {
    throw new Error("Missing artifact root directory.");
  }

  const resolvedRoot = path.resolve(rootDir);
  const normalizedPath = normalizeArtifactPath(artifactPath);
  const targetPath = path.resolve(resolvedRoot, normalizedPath);

  if (!isInsidePath(resolvedRoot, targetPath)) {
    throw new Error(`Unsafe artifact path "${artifactPath}".`);
  }

  const bytes = toBuffer(content);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, bytes);

  return {
    artifact_path: toPortablePath(normalizedPath),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    byte_length: bytes.length,
  };
}

function sanitizePathSegment(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "unknown";
}

function buildArtifactPath({ stage, round = 0, agent, type = "post", id, extension = "md" }) {
  const safeStage = sanitizePathSegment(stage);
  const safeRound = `round-${Number.isFinite(Number(round)) ? Number(round) : 0}`;
  const safeAgent = sanitizePathSegment(agent);
  const safeType = sanitizePathSegment(type);
  const safeId = id ? sanitizePathSegment(id) : safeType;
  const safeExtension = String(extension || "txt").replace(/^\./, "").replace(/[^A-Za-z0-9]+/g, "") || "txt";

  return path.posix.join(safeStage, safeRound, safeAgent, `${safeId}.${safeExtension}`);
}

module.exports = {
  buildArtifactPath,
  normalizeArtifactPath,
  sha256Content,
  writeArtifact,
};
