# Steve - V1 Product Spec

**Version:** 1.2  
**Author:** antal10  
**Date:** 2026-04-02


## Overview

Steve is a local Electron desktop app that opens persistent browser windows to AI services, sends your prompt to each, collects responses, runs one round of cross-deliberation, and produces structured Council Meeting Minutes.

No API keys. No plaintext session export flow. All transport is Playwright browser automation against logged-in sessions.

V1 prioritizes a trustworthy messenger and recorder over downstream analysis features. Steve must preserve exact sent prompts, explicit failures, stage timing, and raw captured outputs before adding any scoring or ranking layers.


## Runtime Storage Model

All Steve runtime state lives outside the repo under the Electron `userData` root. On Windows, Steve stores runtime state under:

`%LOCALAPPDATA%\SteveApp\`

Subdirectories:

- `profiles\<agent>\` for Playwright persistent Chromium profiles
- `logs\` for sanitized app logs
- `run-artifacts\` for JSON run files and runtime artifacts
- `config\` for Electron/session internals and local runtime configuration

Hard invariants:

- No runtime state may be written under the repo root. Do not keep `profiles/`, `sessions/`, `runs/`, `local_data/`, `logs/`, or `run-artifacts/` inside `C:\Steve`.
- Startup must fail if those legacy repo-local runtime directories are detected under the project root.
- All runtime paths must be resolved through [runtime-paths.js](/C:/Steve/runtime/runtime-paths.js).
- Session persistence must use Playwright `launchPersistentContext(userDataDir, ...)` only.
- Steve must not use `storageState()`, cookie JSON exports, or programmatic cookie injection.

Migration note:

- Steve no longer reads repo-local `sessions/` or `runs/`.
- Steve does not auto-copy repo-local session data into the new runtime root.
- Developers must remove old repo-local folders or migrate them explicitly before launch.

## Built-in Roster

Steve currently ships with 7 built-in agents:

- `@o3`
- `@gemini`
- `@copilot`
- `@claude`
- `@sonar`
- `@meta`
- `@grok`

The Control Panel lets the user toggle any of these agents on or off per run.


## Two Screens

### Screen 1 - Control Panel

- Prompt textarea
- Agent chips to toggle agents in or out per run
- Stage indicator: `Idle -> Broadcasting -> Collecting -> Paused -> Deliberating -> Minutes Ready`
- `Run`, `Pause`, and `Resume` controls
- Live log strip at the bottom

### Screen 2 - Council Thread

- Prompt displayed at top as the root post
- Opening statements stream in as they arrive
- Deliberation cross-replies appear with a `replying to @agent` tag
- Meeting Minutes are pinned at the bottom once Stage 4 completes
- Thread is read-only after minutes are generated
- Auto-saves to `%LOCALAPPDATA%\SteveApp\run-artifacts\YYYY-MM-DD_HHMM_runN.json`


## Four Stages

### Stage 1 - Broadcast

Playwright dispatches the user's prompt to all active agents in parallel. Each agent uses its own persistent browser profile under:

`%LOCALAPPDATA%\SteveApp\profiles\<agent>\`

Steve must use `launchPersistentContext(userDataDir, ...)` as the canonical persistence mechanism. It must not use `storageState()`, manual cookie export files, or programmatic cookie injection.

### Stage 2 - Collect

Each agent driver polls for completion, extracts the response text, and stores it as a post object with `stage: "opening"`.

If an agent times out or returns only a partial response, Steve records that explicitly in the run artifact; it does not silently omit the agent from the record.

### Stage 3 - Deliberate

Each agent receives a deliberation prompt containing every other active agent's opening statement. With the full 7-agent roster enabled, Stage 3 produces `7 x 6 = 42` cross-replies. Hard cap: 1 round, no recursion.

Each cross-reply is stored as a post object with `stage: "deliberation"` and `reply_to: "@agentname"`.

If the parser cannot map a reply to an explicit target, Steve records the missing edge in the run artifact instead of fabricating a placeholder post.

### Stage 4 - Minutes

All posts are assembled into a structured prompt and sent to one designated minutes agent. In V1, the preferred minutes agent is `@sonar`, with a fallback to the first successful responder if `@sonar` is unavailable for the run.

The minutes artifact must remain traceable to the exact scribe response via raw captured text, parse status, and source dispatch/post IDs.


## Deliberation Prompt Shape

Sent to each agent during Stage 3:

```text
You are @{agent} in a council of AI advisors.
The user asked: "{prompt}"

Here are the other agents' opening statements:

@{other1}: "{statement1}"
@{other2}: "{statement2}"
@{other3}: "{statement3}"
@{other4}: "{statement4}"
@{other5}: "{statement5}"
@{other6}: "{statement6}"

Reply to each agent separately.
Start each section with "To @agent:".
Write 2-4 sentences per reply.
Start with what you agree on, then state where you disagree or see gaps.
Be direct. No filler.
```


## V1 Constraints

- Electron + Playwright + plain HTML/CSS/JS only
- No frameworks
- No API keys anywhere
- No database; JSON run artifacts only
- No server; everything local, single process
- 7 built-in agents max in V1
- 1 deliberation round only
- No authentication UI; sessions are preserved only through Playwright persistent contexts
- No `storageState()` support
- No manual cookie export/import flow
- No scoring, ranking, weighting, or analytics until the messenger and recorder acceptance tests pass
