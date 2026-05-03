const crypto = require("node:crypto");

function sha256(buffer) {
  return "sha256:" + crypto.createHash("sha256").update(buffer).digest("hex");
}

function hashString(text) {
  return sha256(Buffer.from(String(text), "utf-8"));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }

  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]));
  return "{" + parts.join(",") + "}";
}

function hashJson(value) {
  return hashString(canonicalJson(value));
}

module.exports = { sha256, hashString, hashJson, canonicalJson };
