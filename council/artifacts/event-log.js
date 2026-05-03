/**
 * event-log.js - append-only ledger writer for events.jsonl.
 *
 * Contract (see docs/debate_artifacts.md):
 *   - One JSON object per line.
 *   - Every event has at least { t: ISO8601, kind: string }.
 *   - Writer never reads or parses; this module is write-only.
 *   - Caller is responsible for ordering and content of events.
 *
 * Not implemented yet. The pipeline does not call this module.
 */

function appendEvent(_runDir, _event) {
  throw new Error("event-log.appendEvent not implemented yet");
}

module.exports = { appendEvent };
