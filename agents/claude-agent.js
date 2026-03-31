const BaseAgent = require("./base-agent");

/**
 * Claude agent driver — @claude on claude.ai
 *
 * Selectors target claude.ai (March 2026):
 *   Input:    div.ProseMirror[contenteditable="true"] or fieldset .ProseMirror
 *   Send:     button[aria-label="Send Message"] or Enter key
 *   Response: [data-is-streaming] while generating, .font-claude-message for final text
 */
class ClaudeAgent extends BaseAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "claude",
      name: "Claude",
      siteUrl: "https://claude.ai",
      sessionsDir,
    });
  }

  async typeAndSubmit(page, text) {
    // Try primary input selector
    let input = await page.$('div.ProseMirror[contenteditable="true"]');
    if (!input) {
      input = await page.$("fieldset .ProseMirror");
    }
    if (!input) {
      input = await page.$('[contenteditable="true"]');
    }

    if (!input) {
      throw new Error("Could not find Claude input element");
    }

    await input.click();
    await page.waitForTimeout(300);

    // Type using keyboard for ProseMirror contenteditable
    for (const line of text.split("\n")) {
      await page.keyboard.type(line, { delay: 5 });
      await page.keyboard.press("Shift+Enter");
    }

    await page.waitForTimeout(300);

    // Try the send button first
    const sendBtn = await page.$('button[aria-label="Send Message"]');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    this.log("Prompt sent via Claude interface.");
  }

  async extractResponse(page) {
    // Wait for streaming to finish — check for absence of streaming attribute
    const selectors = [
      ".font-claude-message",
      '[data-is-streaming="false"]',
      ".prose",
    ];

    for (const sel of selectors) {
      const elements = await page.$$(sel);
      if (elements.length > 0) {
        const last = elements[elements.length - 1];
        const text = await last.innerText();
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      }
    }

    return "";
  }
}

module.exports = ClaudeAgent;
