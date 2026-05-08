# Steve - JSON Schema


## Runtime Storage Model

All Steve runtime state lives under the Electron `userData` root. On Windows, Steve uses:

`%LOCALAPPDATA%\SteveApp\`

Subdirectories:

- `profiles\<provider>\` for Playwright persistent Chromium profiles
- `logs\` for sanitized app logs
- `run-artifacts\` for council run JSON files and related artifacts
- `config\` for Electron/session internals and local runtime configuration

Hard invariants:

- No runtime state may be written under the repo root. Do not keep `profiles/`, `sessions/`, `runs/`, `local_data/`, `logs/`, or `run-artifacts/` inside `C:\Steve`.
- Startup fails if those legacy repo-local runtime directories are detected.
- All runtime paths are resolved through [runtime-paths.js](/C:/Steve/runtime/runtime-paths.js).
- Session persistence uses Playwright `launchPersistentContext(userDataDir, ...)` only.
- Steve does not use `storageState()`, cookie JSON exports, or programmatic cookie injection.

Migration note:

- Steve no longer reads repo-local `sessions/` or `runs/`.
- Developers must remove old repo-local folders or migrate them explicitly.
- Steve does not auto-copy sensitive session data out of the repo.

Steve stores run artifacts outside the repo under:

`%LOCALAPPDATA%\SteveApp\run-artifacts\`

One JSON file is written per council session.

## Optional Artifact Mirror

The canonical run identity is the stem of the saved JSON filename. `saveRun` assigns `run_id` before writing the JSON file. If artifact mirroring is explicitly enabled, Steve writes a sibling folder with the same stem only after the JSON file has been written successfully.

Default V1 behavior writes only:

`%LOCALAPPDATA%\SteveApp\run-artifacts\YYYY-MM-DD_HHMM_runN.json`

Optional mirror layout:

```text
run-artifacts/
  YYYY-MM-DD_HHMM_runN.json
  YYYY-MM-DD_HHMM_runN/
    prompt_packet.json
    events.jsonl
    posts/
    matrices/
      opening_matrix.csv
      cross_reply_matrix.csv
      reception_matrix.csv
    packets/
    minutes.json
    deviation_report.json
```

Artifact mirror invariants:

- The JSON file remains authoritative and schema-compatible with V1.
- The mirror folder name must equal `run_id` and the JSON filename stem.
- Filename collisions skip both existing JSON files and existing mirror folders.
- Mirror writes use a temporary folder and rename to prevent partial or orphan mirror folders on failed writes.
- CSV matrices reference content hashes and relative artifact paths; they do not store full post text.
- V1 paid deliberation round packets are compatibility-pinned to [deliberation.js](/C:/Steve/council/deliberation.js) prompt output.

## Run File

One file per council session:

`%LOCALAPPDATA%\SteveApp\run-artifacts\YYYY-MM-DD_HHMM_runN.json`

```json
{
  "run_id": "2026-03-31_1145_run1",
  "status": "partial",
  "timestamp": "2026-03-31T11:45:00Z",
  "prompt": "What is the best approach to adaptive filtering for non-stationary signals?",
  "prompt_sha256": "sha256...",
  "agents_active": ["@o3", "@gemini", "@copilot", "@claude", "@sonar", "@meta", "@grok"],
  "stages_completed": ["broadcast", "collect", "deliberate", "minutes"],
  "stage_timestamps": {
    "broadcast": { "started_at": "", "completed_at": "", "status": "completed", "message": null },
    "collect": { "started_at": "", "completed_at": "", "status": "completed", "message": null },
    "deliberate": { "started_at": "", "completed_at": "", "status": "partial", "message": null },
    "minutes": { "started_at": "", "completed_at": "", "status": "completed", "message": null }
  },
  "duration_seconds": 187,
  "deliberation_rounds": 1,
  "prompt_dispatches": [],
  "posts": [],
  "minutes": {},
  "failures": [],
  "agent_statuses": {},
  "deliberation": {}
}
```

### Run-level status fields

- `status`: overall run terminal state: `"completed"`, `"partial"`, or `"failed"`
- `stage_timestamps`: explicit started/completed timestamps plus stage outcome
- `prompt_dispatches`: every prompt actually sent, including truncated variants
- `failures`: explicit failure records; missing outputs are never represented by omission alone
- `agent_statuses`: per-agent launch/opening/deliberation/minutes state for reconstructability
- `deliberation`: machine-checkable reply matrix with expected/actual/missing pairs


## Prompt Dispatch Object

Every outbound prompt is recorded before or at send time.

```json
{
  "dispatch_id": "d001",
  "stage": "opening",
  "round": 0,
  "agent": "@copilot",
  "timestamp": "2026-03-31T11:45:03Z",
  "original_prompt_text": "The original prompt text...",
  "sent_prompt_text": "The exact text actually sent...",
  "original_chars": 10420,
  "sent_chars": 9800,
  "original_prompt_sha256": "sha256...",
  "sent_prompt_sha256": "sha256...",
  "truncated": true,
  "truncation_limit": 9800,
  "truncated_from_chars": 10420,
  "status": "sent",
  "error": null
}
```


## Post Object

Every message in the council thread, including opening statements, cross-replies, and minutes, is a post.

```json
{
  "post_id": "p001",
  "author": "@o3",
  "stage": "opening",
  "type": "statement",
  "reply_to": null,
  "timestamp": "2026-03-31T11:45:32Z",
  "latency_seconds": 32,
  "content": "The agent's full response text...",
  "raw_content": "The raw captured text for this post...",
  "word_count": 247,
  "capture_status": "complete",
  "source_dispatch_id": "d001"
}
```

### Post types by stage

| Stage | `stage` | `type` | `reply_to` |
|-------|---------|--------|------------|
| Stage 2 - Collect | `"opening"` | `"statement"` | `null` |
| Stage 3 - Deliberate | `"deliberation"` | `"reply"` | `"@agentname"` |
| Stage 4 - Minutes | `"minutes"` | `"minutes"` | `null` |


## Minutes Object

Structured artifact generated by the minutes agent, preferably `@sonar`.

```json
{
  "generated_by": "@sonar",
  "attendees": ["@o3", "@gemini", "@copilot", "@claude", "@sonar", "@meta", "@grok"],
  "points_of_agreement": [
    "All agents agree that LMS-based adaptive filters are the baseline approach."
  ],
  "points_of_disagreement": [
    "@o3 favors RLS for faster convergence; @claude argues LMS is more stable for non-stationary inputs."
  ],
  "unresolved_questions": [
    "What is the optimal forgetting factor for RLS in this domain?"
  ],
  "recommended_next_action": "Run a MATLAB simulation comparing LMS vs. RLS on the target signal.",
  "consensus_level": "moderate",
  "raw_minutes_text": "Plain-English minutes summary...",
  "raw_response_text": "The raw captured scribe response...",
  "parse_status": "json",
  "status": "completed",
  "source_dispatch_id": "d021",
  "source_post_id": "p021"
}
```

### `consensus_level` values

| Value | Meaning |
|-------|---------|
| `"strong"` | All agents substantially agree |
| `"moderate"` | Majority agreement with minor dissent |
| `"split"` | Roughly even disagreement |
| `"unresolved"` | No clear consensus reached |


## Cross-Reply Matrix

With the full 7-agent roster enabled, Stage 3 produces a `7 x 7` matrix minus the diagonal, for **42 cross-reply posts**.

|            | @o3 | @gemini | @copilot | @claude | @sonar | @meta | @grok |
|------------|-----|---------|----------|---------|--------|-------|-------|
| **@o3**      | -   | yes     | yes      | yes     | yes    | yes   | yes   |
| **@gemini**  | yes | -       | yes      | yes     | yes    | yes   | yes   |
| **@copilot** | yes | yes     | -        | yes     | yes    | yes   | yes   |
| **@claude**  | yes | yes     | yes      | -       | yes    | yes   | yes   |
| **@sonar**   | yes | yes     | yes      | yes     | -      | yes   | yes   |
| **@meta**    | yes | yes     | yes      | yes     | yes    | -     | yes   |
| **@grok**    | yes | yes     | yes      | yes     | yes    | yes   | -     |

Each `yes` corresponds to one post with `stage: "deliberation"`, `type: "reply"`, and `reply_to: "@target"`.


## Failure Record

```json
{
  "timestamp": "2026-03-31T11:47:10Z",
  "agent": "@gemini",
  "stage": "deliberation",
  "phase": "parse",
  "message": "Missing explicit replies for @o3, @claude."
}
```


## Agent Status Record

```json
{
  "handle": "@o3",
  "name": "ChatGPT o3-pro",
  "session_dir": "C:\\Users\\Antal\\AppData\\Local\\SteveApp\\profiles\\o3",
  "status": "completed",
  "launch": {
    "status": "completed",
    "started_at": "",
    "completed_at": "",
    "error": null
  },
  "opening": {
    "status": "completed",
    "started_at": "",
    "completed_at": "",
    "response_status": "complete",
    "source_dispatch_id": "d001",
    "post_id": "p001",
    "raw_response_text": "Opening statement...",
    "word_count": 247,
    "error": null
  },
  "deliberation": {
    "status": "partial",
    "started_at": "",
    "completed_at": "",
    "response_status": "partial",
    "source_dispatch_id": "d008",
    "post_ids": ["p008", "p009"],
    "expected_targets": ["@gemini", "@sonar"],
    "actual_targets": ["@gemini"],
    "missing_targets": ["@sonar"],
    "parse_mode": "headed",
    "raw_response_text": "Deliberation reply text...",
    "error": null
  },
  "minutes": {
    "role": "scribe",
    "status": "completed",
    "started_at": "",
    "completed_at": "",
    "response_status": "complete",
    "source_dispatch_id": "d021",
    "post_id": "p021",
    "parse_status": "json",
    "raw_response_text": "Minutes response text...",
    "skip_reason": null,
    "error": null
  },
  "failures": []
}
```
