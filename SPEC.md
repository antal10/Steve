# Steve - V1 Product Spec

**Version:** 1.1  
**Author:** antal10  
**Date:** 2026-03-31

## Overview

Steve is a local Electron desktop app that opens persistent browser windows to your AI services, sends your prompt to each, collects responses, runs one round of cross-deliberation, and produces structured Council Meeting Minutes. No API keys. All transport is Playwright browser automation against logged-in sessions.

## Built-in Roster

Steve currently ships with 5 built-in agents:

- `@o3`
- `@gemini`
- `@copilot`
- `@claude`
- `@sonar`

The Control Panel lets the user toggle any of these agents on or off per run.

## Two Screens

### Screen 1 - Control Panel

- Prompt textarea
- Agent chips to toggle agents in or out per run
- Stage indicator: `Idle -> Broadcasting -> Collecting -> Paused -> Deliberating -> Minutes Ready`
- `Run`, `Pause`, and `Resume` controls
- Live Playwright log strip at the bottom

### Screen 2 - Council Thread

- Prompt displayed at top as the root post
- Opening statements stream in as they arrive
- Deliberation cross-replies appear with a `replying to @agent` tag
- Meeting Minutes are pinned at the bottom once Stage 4 completes
- Thread is read-only after minutes are generated
- Auto-saves to `runs/YYYY-MM-DD_HHMM_runN.json`

## Four Stages

### Stage 1 - Broadcast

Playwright dispatches the user's prompt to all active agents in parallel. Each agent has its own persistent browser context in `sessions/<agent>/` so logins survive between runs.

### Stage 2 - Collect

Each agent driver polls for completion, extracts the response text, and stores it as a post object with `stage: "opening"`.

### Stage 3 - Deliberate

Each agent receives a deliberation prompt containing every other active agent's opening statement. With the full 5-agent roster enabled, Stage 3 produces `5 x 4 = 20` cross-replies. Hard cap: 1 round, no recursion.

Each cross-reply is stored as a post object with `stage: "deliberation"` and `reply_to: "@agentname"`.

### Stage 4 - Minutes

All posts are assembled into a structured prompt and sent to one designated minutes agent. In V1, the preferred minutes agent is `@sonar`, with a fallback to the first successful responder if `@sonar` is unavailable for the run.

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
- No database - JSON files in `runs/`
- No server - everything local, single process
- 5 built-in agents max in V1
- 1 deliberation round only
- No authentication UI - sessions are set up once via Playwright persistent contexts
