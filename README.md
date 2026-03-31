# Steve

Steve is a local-first AI Council desktop app.

You type one prompt. Steve broadcasts it to your AI apps that are already logged in, captures every response, runs a structured deliberation round where agents reply to each other, then produces Council Meeting Minutes as the final artifact.

No API keys. No cloud. No copy-paste.

## How it works

1. You -> Prompt
2. Stage 1: Broadcast to all active agents in parallel
3. Stage 2: Collect opening statements
4. Stage 3: Run one cross-reply round
5. Stage 4: Generate Council Meeting Minutes

## Stack

| Layer | Technology |
|-------|------------|
| Shell | Electron |
| Automation | Playwright (persistent contexts) |
| Frontend | Plain HTML / CSS / JS |
| Data | JSON per run |
| Sessions | Playwright `userDataDir` (login once, reuse forever) |

## Agents

Steve currently ships with a 7-agent roster:

| Handle | Model | Site |
|--------|-------|------|
| @o3 | o3-pro | chatgpt.com |
| @gemini | Gemini 3 | gemini.google.com |
| @copilot | Microsoft Copilot | copilot.microsoft.com |
| @claude | Claude Opus 4.6 | claude.ai |
| @sonar | Sonar Pro | perplexity.ai |
| @meta | Meta AI | meta.ai |
| @grok | Grok | grok.com |

All active agents receive the same prompt and the same deliberation round. No roles, no routing, no weighting.

## Folder Structure

```text
.gitignore
README.md
SPEC.md
SCHEMA.md
package.json
main.js
preload.js
renderer/   UI
agents/     Playwright agent drivers
council/    Deliberation and minutes logic
sessions/   Playwright userDataDir per agent (gitignored)
runs/       JSON run files (gitignored)
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

- V1 -> Prompt -> Opening statements -> Cross-replies -> Minutes
- V2 -> Judge or verdict pass after minutes
- V3 -> MATLAB or Adri integration
- V4 -> Run history browser, search, export
