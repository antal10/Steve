/**
 * artifact-writer.js - writes per-post body files under runs/<run_id>/posts/.
 *
 * Contract (see docs/debate_artifacts.md):
 *   - Filename pattern: <post_id>__<handle>__<stage>[__<target>].md
 *   - File body is the verbatim agent response, no metadata wrapper.
 *   - Returns { artifact: relativePath, content_hash } for the caller to
 *     record in events.jsonl and the matrices.
 *   - Write-once. Re-writing the same post_id is a programming error.
 *
 * Not implemented yet. The pipeline does not call this module.
 */

function writePost(_runDir, _post) {
  throw new Error("artifact-writer.writePost not implemented yet");
}

module.exports = { writePost };
