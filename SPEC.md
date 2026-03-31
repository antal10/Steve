# Steve — V1 Product Spec

**Version:** 1.0
**Author:** antal10
**Date:** 2026-03-31

---

## Overview

Steve is a local Electron desktop app that opens persistent browser windows to your AI services, sends your prompt to each, collects responses, runs one round of cross-deliberation, and produces structured Council Meeting Minutes. No API keys — all transport is Playwright browser automation against logged-in sessions.

---

## Two Screens

### Screen 1 — Control Panel

- Prompt textarea
- Agent chips (toggle each agent in/out per run)
- Stage indicator: `Idle → Broadcasting → Collecting → Deliberating → Minutes Ready`
- **"Convene Council"** button
- Live Playwright log strip at bottom

### Screen 2 — Council Thread

- Prompt displayed at top as root post
- Opening statements stream in as they arrive
- Deliberation cross-replies appear with `↩ replying to @agent` tag
- Meeting Minutes pinned at bottom once Stage 4 completes
- Thread is **read-only** after minutes are generated
- Auto-saves to `runs/YYYY-MM-DD_HHMM_runN.json`

---

## Four Stages

### Stage 1 — Broadcast

Playwright dispatches the user's prompt to all active agents in parallel. Each agent has its own persistent browser context (`sessions/<agent>/`) so logins survive between runs.

### Stage 2 — Collect

Each agent driver polls for completion (stop-button disappearance + text stability), extracts the response text, and stores it as a `post` object with `stage: "opening"`.

### Stage 3 — Deliberate

Each agent receives a deliberation prompt containing every other agent's opening statement. 4 agents × 3 others = **12 cross-replies**. Hard cap: 1 round, no recursion.

Each cross-reply is stored as a `post` object with `stage: "deliberation"` and `reply_to: "@agentname"`.

### Stage 4 — Minutes

All posts (opening statements + cross-replies) are assembled into a structured prompt and sent to one designated "minutes agent" (default: `@sonar`). The minutes agent produces a structured summary stored as the `minutes` object.

---

## Deliberation Prompt Template

Sent to each agent during Stage 3:

```
You are @{agent} in a council of AI advisors.
The user asked: "{prompt}"

Here are the other agents' opening statements:

@{other1}: "{statement1}"
@{other2}: "{statement2}"
@{other3}: "{statement3}"

Reply to each agent in 2–4 sentences.
Start with what you agree on, then state where you disagree or see gaps.
Be direct. No filler.
```

---

## V1 Constraints

- Electron + Playwright + plain HTML/CSS/JS only
- No frameworks (no React, no Vue, no Tailwind)
- No API keys anywhere
- No database — JSON files in `runs/`
- No server — everything local, single process
- 4 agents max in V1
- 1 deliberation round only (no recursion)
- Minutes agent is hardcoded to `@sonar` in V1
- No authentication UI — sessions are set up once via Playwright persistent contexts
