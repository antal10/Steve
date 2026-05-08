const fs = require("fs");
const path = require("path");

const { getRunArtifactsDir } = require("../runtime/runtime-paths");
const {
  resolveArtifactPath,
  validateArtifactFolder,
} = require("./artifact-validator");

function toPortablePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function looksLikePath(value) {
  return path.isAbsolute(value) || /[\\/]/.test(value);
}

function resolveArtifactInput(input, options = {}) {
  if (input && typeof input === "object") {
    const folderPath = input.folderPath || input.artifactFolderPath || input.artifact_dir || input.run_dir;
    const runId = input.run_id || input.runId || options.runId;
    if (folderPath) {
      const runDir = path.resolve(folderPath);
      return {
        run_id: runId || path.basename(runDir),
        run_dir: runDir,
        artifact_root: path.resolve(input.artifactRoot || options.artifactRoot || path.dirname(runDir)),
      };
    }

    if (runId) {
      const artifactRoot = path.resolve(input.artifactRoot || options.artifactRoot || getRunArtifactsDir());
      return {
        run_id: String(runId),
        run_dir: path.join(artifactRoot, String(runId)),
        artifact_root: artifactRoot,
      };
    }
  }

  const value = String(input || "").trim();
  if (!value) {
    throw new Error("Missing artifact mirror input.");
  }

  if (looksLikePath(value)) {
    const runDir = path.resolve(value);
    return {
      run_id: options.runId || path.basename(runDir),
      run_dir: runDir,
      artifact_root: path.resolve(options.artifactRoot || path.dirname(runDir)),
    };
  }

  const artifactRoot = path.resolve(options.artifactRoot || getRunArtifactsDir());
  return {
    run_id: value,
    run_dir: path.join(artifactRoot, value),
    artifact_root: artifactRoot,
  };
}

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  files.sort();
  return files;
}

function readArtifactFile(runDir, filePath) {
  const relativePath = toPortablePath(path.relative(runDir, filePath));
  const bytes = fs.readFileSync(filePath);
  return {
    artifact_path: relativePath,
    content: bytes.toString("utf-8"),
    byte_length: bytes.length,
  };
}

function readArtifactDirectory(runDir, relativeDir) {
  const rootDir = path.join(runDir, relativeDir);
  const artifacts = {};

  for (const filePath of listFilesRecursive(rootDir)) {
    const artifact = readArtifactFile(runDir, filePath);
    const resolved = resolveArtifactPath(runDir, artifact.artifact_path);
    artifacts[resolved.artifact_path] = artifact;
  }

  return artifacts;
}

function loadOptionalJson(runDir, relativePath) {
  const targetPath = path.join(runDir, relativePath);
  if (!fs.existsSync(targetPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
}

function readArtifactMirror(input, options = {}) {
  const resolved = resolveArtifactInput(input, options);
  const validation = validateArtifactFolder(resolved.run_dir, {
    expectedRunId: resolved.run_id,
    artifactRoot: resolved.artifact_root,
  });

  const result = {
    run_id: validation.run_id,
    run_dir: validation.run_dir,
    artifact_root: validation.artifact_root,
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    prompt_packet: validation.parsed.prompt_packet,
    events: validation.parsed.events,
    matrices: validation.parsed.matrices,
    posts: {},
    packets: {},
    minutes: validation.parsed.minutes,
    deviation_report: validation.parsed.deviation_report,
    validation,
  };

  if (!fs.existsSync(validation.run_dir) || !fs.statSync(validation.run_dir).isDirectory()) {
    return result;
  }

  result.posts = readArtifactDirectory(validation.run_dir, "posts");
  result.packets = readArtifactDirectory(validation.run_dir, "packets");

  if (!result.minutes) {
    try {
      result.minutes = loadOptionalJson(validation.run_dir, "minutes.json");
    } catch {
      result.minutes = null;
    }
  }

  if (!result.deviation_report) {
    try {
      result.deviation_report = loadOptionalJson(validation.run_dir, "deviation_report.json");
    } catch {
      result.deviation_report = null;
    }
  }

  return result;
}

module.exports = {
  readArtifactMirror,
  resolveArtifactInput,
};
