# Steve

Steve is a local-first AI Council desktop app.

You type one prompt. Steve broadcasts it to your AI apps — already logged in — captures every response, runs a structured deliberation round where agents reply to each other, then produces **Council Meeting Minutes** as the final artifact.

No API keys. No cloud. No copy-paste.

## How it works

1. You → Prompt
2. **[Stage 1]** Broadcast to all agents (Playwright, parallel)
3. **[Stage 2]** Collect opening statements (one per agent)
4. **[Stage 3]** Cross-reply round (each agent replies to every other agent)
5. **[Stage 4]** Generate Council Meeting Minutes

## Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron |
| Automation | Playwright (persistent contexts) |
| Frontend | Plain HTML / CSS / JS |
| Data | JSON per run |
| Sessions | Playwright `userDataDir` (login once, reuse forever) |

## Agents

| Handle | Model | Site |
|--------|-------|------|
| @o3 | o3-pro | chatgpt.com |
| @claude | Claude Opus 4.6 | claude.ai |
| @sonar | Sonar Pro | perplexity.ai |
| @codex | GPT-5-Codex | chatgpt.com |

All agents receive the same prompt and the same deliberation round. No roles, no routing, no weighting.

## Folder Structure

```
├── .gitignore
├── README.md
├── SPEC.md
├── SCHEMA.md
├── package.json
├── main.js
├── preload.js
├── renderer/         ← UI (built in V1 sprint)
├── agents/           ← Playwright agent drivers
├── council/          ← Deliberation + minutes logic
├── sessions/         ← Playwright userDataDir per agent (gitignored)
└── runs/             ← JSON run files (gitignored)
```

## Quickstart

```bash
git clone https://github.com/antal10/Steve.git
cd Steve
npm install
npx playwright install chromium
npm start
```

## Roadmap

- **V1** → Prompt → Opening statements → Cross-replies → Minutes
- **V2** → Judge/verdict pass after minutes
- **V3** → MATLAB/Adri integration
- **V4** → Run history browser, search, export
