const BaseAgent = require("./base-agent");

/**
 * Claude agent driver — @claude on claude.ai
 *
 * Selectors target claude.ai (March 2026):
 *   Input:    div.ProseMirror[contenteditable="true"] or fieldset .ProseMirror
 *   Send:     button[aria-label="Send Message"] or Enter key
 *   Response: .font-claude-message for final text
 *
 * Uses clipboard paste. Stays in thread for deliberation.
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

    // Use clipboard paste instead of letter-by-letter typing
    try {
      await this.clipboardPaste(page, input, text);
    } catch (e) {
      this.log("Clipboard paste failed, trying direct paste...");
      await this.directPaste(page, input, text);
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
    // Wait for streaming to finish — get latest message
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
