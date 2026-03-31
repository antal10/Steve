const ChatGPTAgent = require("./chatgpt-agent");

/**
 * Codex agent driver — @codex on chatgpt.com using the codex model.
 * Shares the same ChatGPT interface as @o3 but with a different model config.
 */
class CodexAgent extends ChatGPTAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "codex",
      name: "ChatGPT Codex",
      siteUrl: "https://chatgpt.com",
      sessionsDir,
      model: "codex",
    });
  }
}

module.exports = CodexAgent;
