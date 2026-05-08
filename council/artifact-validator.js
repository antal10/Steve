const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { EVENT_FIELDS } = require("./event-log");

const REQUIRED_FILES = [
  "prompt_packet.json",
  "events.jsonl",
  "matrices/opening_matrix.csv",
  "matrices/cross_reply_matrix.csv",
];

const OPTIONAL_FILES = [
  "matrices/reception_matrix.csv",
  "minutes.json",
  "deviation_report.json",
];

function isInsidePath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPortablePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function makeIssue(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf-8").digest("hex");
}

function fileHash(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function normalizeArtifactPath(artifactPath) {
  const value = String(artifactPath || "").trim();
  if (!value) {
    return "";
  }

  if (path.isAbsolute(value)) {
    throw new Error(`Artifact path must be relative: ${artifactPath}`);
  }

  const normalized = path.normalize(value);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe artifact path "${artifactPath}".`);
  }

  return normalized;
}

function resolveArtifactPath(runDir, artifactPath) {
  const normalized = normalizeArtifactPath(artifactPath);
  if (!normalized) {
    return {
      artifact_path: "",
      target_path: "",
    };
  }

  const resolvedRunDir = path.resolve(runDir);
  const targetPath = path.resolve(resolvedRunDir, normalized);
  if (!isInsidePath(resolvedRunDir, targetPath)) {
    throw new Error(`Unsafe artifact path "${artifactPath}".`);
  }

  return {
    artifact_path: toPortablePath(normalized),
    target_path: targetPath,
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function parseJsonlFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/);
  const events = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }

    try {
      events.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`events.jsonl line ${i + 1} is not valid JSON: ${err.message}`);
    }
  }

  return events;
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    throw new Error("CSV ended inside a quoted cell.");
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function parseCsvFile(filePath) {
  const rows = parseCsvText(fs.readFileSync(filePath, "utf-8"));
  if (rows.length === 0) {
    return {
      headers: [],
      rows: [],
    };
  }

  const headers = rows[0];
  return {
    headers,
    rows: rows.slice(1)
      .filter((row) => row.some((cell) => cell !== ""))
      .map((row) => {
        const record = {};
        for (let i = 0; i < headers.length; i++) {
          record[headers[i]] = row[i] ?? "";
        }
        return record;
      }),
  };
}

function getMatrixPath(name) {
  return `matrices/${name}`;
}

function pushRequiredFileChecks(runDir, errors) {
  for (const relativePath of REQUIRED_FILES) {
    const filePath = path.join(runDir, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      errors.push(makeIssue("required_file_missing", `Missing required artifact file: ${relativePath}`, {
        artifact_path: relativePath,
      }));
    }
  }
}

function pushOptionalFileWarnings(runDir, warnings) {
  for (const relativePath of OPTIONAL_FILES) {
    const filePath = path.join(runDir, relativePath);
    if (!fs.existsSync(filePath)) {
      warnings.push(makeIssue("optional_file_missing", `Optional artifact file is missing: ${relativePath}`, {
        artifact_path: relativePath,
      }));
    }
  }

  for (const relativePath of ["posts", "packets"]) {
    const dirPath = path.join(runDir, relativePath);
    if (!fs.existsSync(dirPath)) {
      warnings.push(makeIssue("optional_directory_missing", `Optional artifact directory is missing: ${relativePath}`, {
        artifact_path: relativePath,
      }));
    }
  }
}

function validatePromptPacket(runDir, runId, parsed, errors) {
  const filePath = path.join(runDir, "prompt_packet.json");
  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    const promptPacket = readJsonFile(filePath);
    parsed.prompt_packet = promptPacket;

    if (promptPacket.run_id !== runId) {
      errors.push(makeIssue("run_id_mismatch", "prompt_packet.json run_id does not match artifact folder name.", {
        expected: runId,
        actual: promptPacket.run_id,
      }));
    }

    if (promptPacket.prompt_sha256 && sha256Text(promptPacket.prompt || "") !== promptPacket.prompt_sha256) {
      errors.push(makeIssue("hash_mismatch", "prompt_packet.json prompt_sha256 does not match prompt content.", {
        artifact_path: "prompt_packet.json",
      }));
    }

    if (
      typeof promptPacket.prompt_byte_length === "number"
      && Buffer.byteLength(String(promptPacket.prompt || ""), "utf-8") !== promptPacket.prompt_byte_length
    ) {
      errors.push(makeIssue("byte_length_mismatch", "prompt_packet.json prompt_byte_length does not match prompt content.", {
        artifact_path: "prompt_packet.json",
      }));
    }
  } catch (err) {
    errors.push(makeIssue("required_json_invalid", `prompt_packet.json is not valid JSON: ${err.message}`, {
      artifact_path: "prompt_packet.json",
    }));
  }
}

function validateEvents(runDir, runId, parsed, errors, warnings) {
  const filePath = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    const events = parseJsonlFile(filePath);
    parsed.events = events;

    if (events.length === 0) {
      errors.push(makeIssue("events_empty", "events.jsonl contains no events.", {
        artifact_path: "events.jsonl",
      }));
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const line = i + 1;

      for (const field of EVENT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(event, field)) {
          errors.push(makeIssue("event_field_missing", `events.jsonl line ${line} is missing ${field}.`, {
            artifact_path: "events.jsonl",
            line,
            field,
          }));
        }
      }

      if (event.run_id !== runId) {
        errors.push(makeIssue("run_id_mismatch", `events.jsonl line ${line} run_id does not match artifact folder name.`, {
          artifact_path: "events.jsonl",
          line,
          expected: runId,
          actual: event.run_id,
        }));
      }

      if (!event.artifact_path) {
        continue;
      }

      let resolved;
      try {
        resolved = resolveArtifactPath(runDir, event.artifact_path);
      } catch (err) {
        errors.push(makeIssue("unsafe_artifact_path", `events.jsonl line ${line} has an unsafe artifact_path: ${err.message}`, {
          artifact_path: event.artifact_path,
          line,
        }));
        continue;
      }

      if (!fs.existsSync(resolved.target_path)) {
        warnings.push(makeIssue("event_artifact_missing", `events.jsonl line ${line} references a missing artifact file.`, {
          artifact_path: event.artifact_path,
          line,
        }));
        continue;
      }

      const expectedHash = event.response_hash || (
        event.type === "prompt_packet" || event.type === "round_packet" || event.type === "prompt"
          ? event.prompt_hash
          : null
      );
      if (expectedHash && fileHash(resolved.target_path) !== expectedHash) {
        errors.push(makeIssue("hash_mismatch", `events.jsonl line ${line} hash does not match artifact file content.`, {
          artifact_path: event.artifact_path,
          line,
        }));
      }
    }
  } catch (err) {
    errors.push(makeIssue("required_jsonl_invalid", err.message, {
      artifact_path: "events.jsonl",
    }));
  }
}

function validateMatrix(runDir, matrixName, required, parsed, errors) {
  const relativePath = getMatrixPath(matrixName);
  const filePath = path.join(runDir, relativePath);

  if (!fs.existsSync(filePath)) {
    if (required) {
      errors.push(makeIssue("required_file_missing", `Missing required matrix: ${relativePath}`, {
        artifact_path: relativePath,
      }));
    }
    return;
  }

  try {
    const matrix = parseCsvFile(filePath);
    parsed.matrices[matrixName.replace(".csv", "")] = matrix;

    if (matrix.rows.length > 0 && matrix.headers.includes("artifact_path")) {
      for (let i = 0; i < matrix.rows.length; i++) {
        const row = matrix.rows[i];
        const rowNumber = i + 2;
        const artifactPath = row.artifact_path;
        if (!artifactPath) {
          continue;
        }

        let resolved;
        try {
          resolved = resolveArtifactPath(runDir, artifactPath);
        } catch (err) {
          errors.push(makeIssue("unsafe_artifact_path", `${relativePath} row ${rowNumber} has an unsafe artifact_path: ${err.message}`, {
            artifact_path: artifactPath,
            matrix: relativePath,
            row: rowNumber,
          }));
          continue;
        }

        if (!fs.existsSync(resolved.target_path)) {
          errors.push(makeIssue("matrix_artifact_missing", `${relativePath} row ${rowNumber} references a missing artifact file.`, {
            artifact_path: artifactPath,
            matrix: relativePath,
            row: rowNumber,
          }));
          continue;
        }

        if (row.response_hash && fileHash(resolved.target_path) !== row.response_hash) {
          errors.push(makeIssue("hash_mismatch", `${relativePath} row ${rowNumber} response_hash does not match artifact file content.`, {
            artifact_path: artifactPath,
            matrix: relativePath,
            row: rowNumber,
          }));
        }

        if (row.byte_length && /^\d+$/.test(row.byte_length)) {
          const actualLength = fs.statSync(resolved.target_path).size;
          if (actualLength !== Number(row.byte_length)) {
            errors.push(makeIssue("byte_length_mismatch", `${relativePath} row ${rowNumber} byte_length does not match artifact file content.`, {
              artifact_path: artifactPath,
              matrix: relativePath,
              row: rowNumber,
            }));
          }
        }
      }
    }
  } catch (err) {
    errors.push(makeIssue("csv_invalid", `${relativePath} could not be parsed: ${err.message}`, {
      artifact_path: relativePath,
    }));
  }
}

function validateOptionalJson(runDir, relativePath, parsed, errors) {
  const filePath = path.join(runDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    parsed[relativePath.replace(".json", "")] = readJsonFile(filePath);
  } catch (err) {
    errors.push(makeIssue("optional_json_invalid", `${relativePath} is not valid JSON: ${err.message}`, {
      artifact_path: relativePath,
    }));
  }
}

function validateArtifactFolder(runDir, options = {}) {
  const resolvedRunDir = path.resolve(runDir || "");
  const artifactRoot = path.resolve(options.artifactRoot || path.dirname(resolvedRunDir));
  const folderName = path.basename(resolvedRunDir);
  const expectedRunId = options.expectedRunId || folderName;
  const errors = [];
  const warnings = [];
  const parsed = {
    prompt_packet: null,
    events: [],
    matrices: {},
    minutes: null,
    deviation_report: null,
  };

  if (!runDir) {
    errors.push(makeIssue("artifact_folder_missing", "Missing artifact folder path."));
    return {
      valid: false,
      run_id: expectedRunId,
      run_dir: resolvedRunDir,
      artifact_root: artifactRoot,
      errors,
      warnings,
      parsed,
    };
  }

  if (!isInsidePath(artifactRoot, resolvedRunDir)) {
    errors.push(makeIssue("artifact_folder_escape", "Artifact folder is outside the artifact root.", {
      run_dir: resolvedRunDir,
      artifact_root: artifactRoot,
    }));
  }

  if (!fs.existsSync(resolvedRunDir) || !fs.statSync(resolvedRunDir).isDirectory()) {
    errors.push(makeIssue("artifact_folder_missing", "Artifact folder does not exist.", {
      run_dir: resolvedRunDir,
    }));
    return {
      valid: false,
      run_id: expectedRunId,
      run_dir: resolvedRunDir,
      artifact_root: artifactRoot,
      errors,
      warnings,
      parsed,
    };
  }

  if (folderName !== expectedRunId) {
    errors.push(makeIssue("run_id_mismatch", "Artifact folder name does not match expected run_id.", {
      expected: expectedRunId,
      actual: folderName,
    }));
  }

  pushRequiredFileChecks(resolvedRunDir, errors);
  pushOptionalFileWarnings(resolvedRunDir, warnings);
  validatePromptPacket(resolvedRunDir, expectedRunId, parsed, errors);
  validateEvents(resolvedRunDir, expectedRunId, parsed, errors, warnings);
  validateMatrix(resolvedRunDir, "opening_matrix.csv", true, parsed, errors);
  validateMatrix(resolvedRunDir, "cross_reply_matrix.csv", true, parsed, errors);
  validateMatrix(resolvedRunDir, "reception_matrix.csv", false, parsed, errors);
  validateOptionalJson(resolvedRunDir, "minutes.json", parsed, errors);
  validateOptionalJson(resolvedRunDir, "deviation_report.json", parsed, errors);

  return {
    valid: errors.length === 0,
    run_id: expectedRunId,
    run_dir: resolvedRunDir,
    artifact_root: artifactRoot,
    errors,
    warnings,
    parsed,
  };
}

module.exports = {
  OPTIONAL_FILES,
  REQUIRED_FILES,
  parseCsvText,
  parseCsvFile,
  parseJsonlFile,
  resolveArtifactPath,
  sha256Text,
  validateArtifactFolder,
};
