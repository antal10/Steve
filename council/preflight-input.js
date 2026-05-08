const crypto = require("crypto");
const path = require("path");

const PREFLIGHT_SCHEMA_VERSION = "steve.v1.preflight_input";
const ISO_LIKE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function makeIssue(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function sha256Utf8(value) {
  return crypto.createHash("sha256").update(Buffer.from(value, "utf-8")).digest("hex");
}

function byteLengthUtf8(value) {
  return Buffer.byteLength(value, "utf-8");
}

function hasUnsafePathSegments(value) {
  const normalized = String(value).replace(/\\/g, "/");
  return normalized.split("/").some((segment) => segment === "..");
}

function isAbsoluteReferencePath(value) {
  return path.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.posix.isAbsolute(value)
    || /^[A-Za-z]:/.test(value);
}

function isUnsafeReferencePath(value) {
  const text = String(value || "");
  return text.includes("\0")
    || isAbsoluteReferencePath(text)
    || hasUnsafePathSegments(text);
}

function isIsoLikeTimestamp(value) {
  return ISO_LIKE_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function validateReferenceValue(value, errors, location) {
  if (typeof value === "string") {
    if (isUnsafeReferencePath(value)) {
      errors.push(makeIssue("unsafe_reference_path", "Reference path is unsafe.", {
        path: location,
        value,
      }));
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateReferenceValue(value[i], errors, `${location}[${i}]`);
    }
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (typeof childValue === "string" && isUnsafeReferencePath(childValue)) {
      errors.push(makeIssue("unsafe_reference_path", "Reference path is unsafe.", {
        path: childLocation,
        value: childValue,
      }));
      continue;
    }

    if (childValue && typeof childValue === "object") {
      validateReferenceValue(childValue, errors, childLocation);
    }
  }
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function validatePreflightInput(packet) {
  const errors = [];

  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    errors.push(makeIssue("packet_invalid", "Preflight input must be an object."));
    return {
      valid: false,
      errors,
      warnings: [],
    };
  }

  if (packet.schema_version !== PREFLIGHT_SCHEMA_VERSION) {
    errors.push(makeIssue("schema_version_invalid", "Preflight input schema_version is invalid.", {
      expected: PREFLIGHT_SCHEMA_VERSION,
      actual: packet.schema_version,
    }));
  }

  if (!Object.prototype.hasOwnProperty.call(packet, "prompt")) {
    errors.push(makeIssue("prompt_missing", "Preflight input prompt is required."));
  } else if (typeof packet.prompt !== "string") {
    errors.push(makeIssue("prompt_invalid", "Preflight input prompt must be a string."));
  }

  if (typeof packet.prompt === "string") {
    const expectedHash = sha256Utf8(packet.prompt);
    const expectedByteLength = byteLengthUtf8(packet.prompt);

    if (packet.prompt_sha256 !== expectedHash) {
      errors.push(makeIssue("prompt_hash_mismatch", "prompt_sha256 does not match exact UTF-8 prompt bytes.", {
        expected: expectedHash,
        actual: packet.prompt_sha256,
      }));
    }

    if (packet.prompt_byte_length !== expectedByteLength) {
      errors.push(makeIssue("prompt_byte_length_mismatch", "prompt_byte_length does not match exact UTF-8 prompt bytes.", {
        expected: expectedByteLength,
        actual: packet.prompt_byte_length,
      }));
    }
  }

  if (packet.run_id !== null && typeof packet.run_id !== "string") {
    errors.push(makeIssue("run_id_invalid", "run_id must be a string or null."));
  } else if (packet.run_id === "") {
    errors.push(makeIssue("run_id_invalid", "run_id must not be an empty string."));
  }

  if (packet.agents_active !== null) {
    if (!Array.isArray(packet.agents_active)) {
      errors.push(makeIssue("agents_active_invalid", "agents_active must be an array of strings or null."));
    } else {
      for (let i = 0; i < packet.agents_active.length; i++) {
        if (typeof packet.agents_active[i] !== "string") {
          errors.push(makeIssue("agents_active_invalid", "agents_active must contain only strings.", {
            index: i,
          }));
        }
      }
    }
  }

  if (packet.timestamp !== null && typeof packet.timestamp !== "string") {
    errors.push(makeIssue("timestamp_invalid", "timestamp must be a string or null."));
  } else if (typeof packet.timestamp === "string" && !isIsoLikeTimestamp(packet.timestamp)) {
    errors.push(makeIssue("timestamp_invalid", "timestamp must be a parseable ISO-like string or null."));
  }

  if (!Array.isArray(packet.references)) {
    errors.push(makeIssue("references_invalid", "references must be an array."));
  } else {
    for (let i = 0; i < packet.references.length; i++) {
      validateReferenceValue(packet.references[i], errors, `references[${i}]`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}

function assertValidPacket(packet) {
  const validation = validatePreflightInput(packet);
  if (!validation.valid) {
    const message = validation.errors.map((error) => error.message).join(" ");
    const err = new Error(message || "Invalid preflight input.");
    err.validation = validation;
    throw err;
  }
}

function buildPreflightInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Preflight input builder requires an input object.");
  }

  if (typeof input.prompt !== "string") {
    throw new Error("Preflight input prompt must be a string.");
  }

  const references = input.references === undefined
    ? []
    : cloneJsonValue(input.references);
  const agentsActive = input.agents_active === undefined
    ? null
    : cloneJsonValue(input.agents_active);

  const packet = {
    schema_version: PREFLIGHT_SCHEMA_VERSION,
    prompt: input.prompt,
    prompt_sha256: sha256Utf8(input.prompt),
    prompt_byte_length: byteLengthUtf8(input.prompt),
    run_id: input.run_id === undefined ? null : input.run_id,
    agents_active: agentsActive,
    timestamp: input.timestamp === undefined ? null : input.timestamp,
    references,
  };

  assertValidPacket(packet);
  return deepFreeze(packet);
}

module.exports = {
  PREFLIGHT_SCHEMA_VERSION,
  buildPreflightInput,
  byteLengthUtf8,
  isIsoLikeTimestamp,
  sha256Utf8,
  validatePreflightInput,
};
