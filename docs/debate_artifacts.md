# Steve - Debate Artifacts (Design)

**Status:** Design only. No code in `council/pipeline.js` changes as part of this
document. Paid Steve V1 keeps running exactly as it does today.

## Why this exists

Steve's V1 paid council passes debate state around as in-memory strings. That
works for one round of seven agents, but it falls over the moment we want to:

- Compare what one agent said in Round 1 vs Round 2.
- Diff a future *local* preflight pass against the paid council's pass.
- Hand a reviewer a self-contained run folder they can grep, replay, or audit.

The fix is not a framework. It is a small, boring **artifact + ledger**
convention so every debate round has one frozen source of truth on disk.

## Hard constraints

- JSON / JSONL is canonical truth.
- CSV is a derived **matrix view** for humans; never the source of truth.
- Long model output lives in standalone artifact files, not inside CSV cells.
- Each round has a frozen **round packet**. Every agent in that round sees the
  exact same packet bytes.
- **Barrier first, broadcast second.** Round N is closed before Round N+1 is
  composed.
- The current single-file run JSON stays valid. The folder shape below is
  additive.

## Run folder layout (future-compatible)

```text
runs/2026-05-03_1145_run1/
  run.json                       # canonical run summary (same shape as V1 single-file)
  prompt_packet.json             # frozen user prompt + active roster + run config
  events.jsonl                   # append-only ledger of every state transition
  posts/
    p001__o3__opening.md         # one file per post; long-form text artifact
    p002__claude__opening.md
    p010__o3__reply_to_claude.md
    ...
  packets/
    round_1_packet.md            # exact bytes broadcast to all agents in round 1
    round_2_packet.md            # (future) exact bytes broadcast in round 2
  matrices/
    opening_matrix.csv           # one row per agent, columns: handle, post_id, latency_s, word_count, hash
    cross_reply_matrix.csv       # author x target ledger view (no body text in cells)
    reception_matrix.csv         # for each post: who saw it, in which packet, with which hash
  minutes.json                   # structured minutes (same shape as today)
  deviation_report.json          # (future, optional) local-vs-paid divergence summary
```

Today's V1 writes only `run.json` (as a flat file, not inside a folder). That
remains supported. The folder layout is what we grow into when we implement the
artifact writer; nothing else needs to ship simultaneously.

## File contracts

### prompt_packet.json

The frozen input to the run. Written once, never mutated.

```json
{
  "run_id": "2026-05-03_1145_run1",
  "created_at": "2026-05-03T11:45:00Z",
  "user_prompt": "What is the best approach to adaptive filtering...",
  "agents_active": ["@o3", "@gemini", "@copilot", "@claude", "@sonar", "@meta", "@grok"],
  "config": {
    "max_rounds": 1,
    "minutes_agent_preference": "@sonar",
    "local_preflight_enabled": false
  },
  "content_hash": "sha256:..."
}
```

`content_hash` is computed over a canonical JSON serialization of every field
above except itself. Anyone who claims "agent X saw this prompt" can prove it
by referencing the hash.

### events.jsonl

Append-only ledger. One JSON object per line. Events are timestamped state
transitions. The ledger is the source of truth for *what happened*; the
artifacts are the source of truth for *what was said*.

```json
{"t":"2026-05-03T11:45:00Z","kind":"run_started","run_id":"..."}
{"t":"2026-05-03T11:45:01Z","kind":"agent_launched","agent":"@o3"}
{"t":"2026-05-03T11:45:32Z","kind":"post_written","post_id":"p001","author":"@o3","stage":"opening","artifact":"posts/p001__o3__opening.md","content_hash":"sha256:..."}
{"t":"2026-05-03T11:46:10Z","kind":"round_frozen","round":1,"packet":"packets/round_1_packet.md","content_hash":"sha256:..."}
{"t":"2026-05-03T11:46:11Z","kind":"packet_delivered","round":2,"agent":"@claude","content_hash":"sha256:..."}
```

JSONL is chosen over JSON-array so partial writes during a crash still parse.

### posts/ artifact files

One file per post. Filename pattern: `<post_id>__<handle>__<stage>[__<target>].md`.
The file body is the agent's verbatim response. Metadata (latency, word count,
hash, parent ids) lives in `events.jsonl` and the matrices, not in the body.

This is the rule that kills "giant CSV cells": the matrix references the
artifact path; it does not embed the text.

### matrices/opening_matrix.csv

One row per active agent for Stage 2 output.

```csv
handle,post_id,artifact,latency_seconds,word_count,content_hash
@o3,p001,posts/p001__o3__opening.md,32,247,sha256:...
@claude,p002,posts/p002__claude__opening.md,28,205,sha256:...
```

### matrices/cross_reply_matrix.csv

The 7x7-minus-diagonal grid as a ledger, one row per (author, target) pair.

```csv
author,target,post_id,artifact,latency_seconds,word_count,content_hash
@o3,@claude,p010,posts/p010__o3__reply_to_claude.md,18,84,sha256:...
@o3,@gemini,p011,posts/p011__o3__reply_to_gemini.md,18,76,sha256:...
...
```

This replaces today's "everything in `posts[]`" reading style for analysts who
want a quick `grep` or pivot, without ever pulling text into a cell.

### matrices/reception_matrix.csv

Records *what each agent was shown*, not just what they wrote. This is what
makes deviation analysis possible later.

```csv
recipient,round,packet,packet_hash,source_post_id,source_artifact,source_hash
@claude,1,packets/round_1_packet.md,sha256:...,p001,posts/p001__o3__opening.md,sha256:...
@claude,1,packets/round_1_packet.md,sha256:...,p003,posts/p003__gemini__opening.md,sha256:...
```

If two agents in the same round have different `packet_hash` values, the
barrier was violated. That is detectable post-hoc.

### packets/round_X_packet.md

The exact rendered text broadcast to every agent at the start of round X.
Written once, immutable. Its `content_hash` appears in `events.jsonl` and in
the reception matrix for every recipient.

### minutes.json

Same shape as today's `minutes` object in `SCHEMA.md`. Promoted to its own
file so a reviewer can `cat minutes.json` without scrolling through posts.

### deviation_report.json (future, optional)

Generated only when an optional local preflight stage runs *and* the paid
council also runs. Compares the two on a per-post basis. Not implemented yet
and intentionally out of scope for this design patch. Sketch:

```json
{
  "run_id": "...",
  "local_preflight": { "ran": true, "model": "qwen-..." },
  "paid_council":    { "ran": true },
  "by_agent": {
    "@claude": {
      "opening_similarity": 0.81,
      "topic_drift": ["mentioned RLS only in paid pass"]
    }
  }
}
```

## Barrier synchronization rules

The data model only works if rounds are honest about ordering.

1. **Freeze before fan-out.** Round N+1's packet is composed only after every
   Round N post is written to disk *and* recorded in `events.jsonl` with a
   `post_written` event. The `round_frozen` event marks the barrier.
2. **One packet per round.** Every agent in Round N+1 receives the same bytes.
   Verified by storing one `content_hash` for `round_N_packet.md` and asserting
   the reception matrix lists that same hash for every recipient.
3. **No back-channel reads.** An agent in Round N must not be shown another
   Round N response mid-flight. If we ever need streaming intra-round visibility,
   that is a different round.
4. **Append-only ledger.** Posts and events are write-once. Re-running a round
   produces a new round, not an overwrite.
5. **Crash recovery.** Because `events.jsonl` and per-post artifacts are written
   incrementally, a partial run can be inspected and resumed or discarded
   without corrupting earlier rounds.

## JSON vs CSV responsibilities

| Concern                           | Lives in              |
|-----------------------------------|-----------------------|
| Verbatim agent text               | `posts/*.md`          |
| Run config and prompt             | `prompt_packet.json`  |
| State transitions, timing         | `events.jsonl`        |
| Round broadcast bytes             | `packets/round_*.md`  |
| Structured minutes                | `minutes.json`        |
| Quick tabular views for humans    | `matrices/*.csv`      |
| Local-vs-paid comparison          | `deviation_report.json` (future) |

CSV files are **regenerable** from the JSON/JSONL artifacts. If any matrix is
deleted, the run is still valid; if any JSON or JSONL artifact is deleted, the
run is corrupted.

## Stages, restated

The paid V1 stages are unchanged:

```text
broadcast -> collect -> deliberate -> minutes
```

A future **optional** Stage 0 would sit in front:

```text
[Stage 0: local preflight (optional)] -> broadcast -> collect -> deliberate -> minutes
```

Stage 0 produces its own posts and packets in the same folder layout, tagged
with `source: "local"` in their event entries. The paid stages produce posts
tagged `source: "paid"`. Comparing the two yields `deviation_report.json`. None
of this is implemented yet.

## Non-goals

- No local model integration in this patch.
- No change to `council/pipeline.js`, the agent classes, or Playwright behavior.
- No Projects / Spaces concept.
- No agent roles, weights, or routing.
- No external dependencies beyond Node built-ins.
- No multi-round deliberation engine. V1 stays at one round; the round packet
  shape is forward-compatible if we ever add more.
- No retry orchestration framework. A failed agent in a round stays failed for
  that round; the matrices show empty cells.

## Module boundary (proposal)

Five small modules under `council/artifacts/`. Each is single-purpose. None
are wired into `pipeline.js` in this patch.

| Module               | Responsibility                                                    |
|----------------------|-------------------------------------------------------------------|
| `hash.js`            | Canonical sha256 of JSON values and strings.                      |
| `event-log.js`       | Append a typed event line to `events.jsonl`. No reads, no parse.  |
| `artifact-writer.js` | Write a post body to `posts/<id>__<handle>__<stage>.md`, return hash. |
| `matrix-writer.js`   | Render the three matrix CSVs from in-memory post records.         |
| `round-packet.js`    | Build a Round N packet from frozen Round N-1 posts; return text + hash. |

Each module is pure with respect to its inputs (no global state) and writes to
a caller-supplied run directory. That keeps tests trivial and lets the future
Stage 0 reuse the same plumbing.

## How to implement the next slice

1. Implement `hash.js` (done in this patch).
2. Implement `event-log.js` and `artifact-writer.js` against an in-memory
   tempdir test. No pipeline wiring.
3. Implement `round-packet.js`; verify the Round 1 packet generated from
   today's `buildDeliberationPrompt` matches byte-for-byte when fed the same
   inputs. This is the regression guard.
4. Implement `matrix-writer.js` last, since it is purely derived.
5. Add a *new* code path in `pipeline.js` guarded by a config flag
   (`config.write_artifacts`, default `false`) that mirrors writes into the
   folder layout. Existing `run-store.js` keeps working unchanged.
6. Only after all of the above lands, scope an optional Stage 0.
