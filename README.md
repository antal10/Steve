# Steve

Steve is a local-first AI Council desktop app.

You type one prompt. Steve broadcasts it to AI apps that are already logged in, captures every response, runs a structured deliberation round where agents reply to each other, then produces Council Meeting Minutes as the final artifact.

No API keys. No cloud API transport. No copy-paste.


## How it works

1. You enter a prompt.
2. Stage 1: Broadcast to all active agents in parallel.
3. Stage 2: Collect opening statements.
4. Stage 3: Run one cross-reply round.
5. Stage 4: Generate Council Meeting Minutes.


## Stack

| Layer | Technology |
|-------|------------|
| Shell | Electron |
| Automation | Playwright `launchPersistentContext` |
| Frontend | Plain HTML / CSS / JS |
| Data | JSON run artifacts |
| Session persistence | Chromium profile directories, one per provider |


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


## Runtime Storage Model

All Steve runtime state lives under the Electron `userData` root. On Windows, Steve configures that root under `%LOCALAPPDATA%\SteveApp\`.

Layout:

- `profiles\<provider>\`: Playwright persistent Chromium profile for one provider. This is the only supported session persistence mechanism.
- `logs\`: sanitized application logs. These may still be sensitive and remain outside the repo.
- `run-artifacts\`: saved council run JSON and other runtime artifacts.
- `config\`: Electron session internals and local runtime configuration.

Hard invariants:

- No runtime state is written under the repo root. Do not keep `profiles/`, `sessions/`, `runs/`, `local_data/`, `logs/`, or `run-artifacts/` inside `C:\Steve`.
- Startup will fail if those legacy repo-local runtime directories are detected.
- All runtime path resolution goes through [runtime-paths.js](/C:/Steve/runtime/runtime-paths.js).
- Browser persistence uses Playwright `launchPersistentContext(userDataDir, ...)` only.
- Steve does not use `storageState()`, cookie JSON exports, or programmatic cookie injection.

These directories are sensitive. They may contain authenticated browser state, run history, and local app metadata. They are intentionally kept outside the repo tree, and `.gitignore` is only a secondary backstop.

Migration note:

- Steve no longer reads repo-local `sessions/` or `runs/`.
- Remove old repo-local runtime folders or migrate them explicitly before launching the app.
- Steve does not auto-copy sensitive browser session data out of the repo.

## Project Layout

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
runtime/    Runtime path policy and storage helpers
tests/      Node test suite
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
