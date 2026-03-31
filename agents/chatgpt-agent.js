const BaseAgent = require("./base-agent");

/**
 * ChatGPT agent driver — used for both @o3 (o3-pro) and @codex models.
 *
 * Selectors target chatgpt.com (March 2026):
 *   Input:    #prompt-textarea or div[contenteditable="true"]
 *   Send:     button[data-testid="send-button"] or Enter key
 *   Response: .markdown in last assistant message, or [data-message-author-role="assistant"]
 *
 * Uses clipboard paste instead of letter-by-letter typing.
 * Stays in the same thread for deliberation follow-ups.
 */
class ChatGPTAgent extends BaseAgent {
  constructor({ handle, name, siteUrl, sessionsDir, model }) {
    super({ handle, name, siteUrl, sessionsDir });
    this.model = model; // "o3-pro" or "codex"
    this._responseCount = 0; // Track how many responses to skip
  }

  async typeAndSubmit(page, text) {
    // Try the primary input selector first
    let input = await page.$("#prompt-textarea");
    if (!input) {
      input = await page.$('div[contenteditable="true"]');
    }

    if (!input) {
      throw new Error("Could not find ChatGPT input element");
    }

    // Use clipboard paste
    try {
      await this.clipboardPaste(page, input, text);
    } catch (e) {
      this.log("Clipboard paste failed, trying direct paste...");
      await this.directPaste(page, input, text);
    }

    await page.waitForTimeout(300);

    // Try clicking the send button first
    const sendBtn = await page.$('button[data-testid="send-button"]');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Record that we expect one more response
    this._responseCount++;
    this.log("Prompt sent via ChatGPT interface.");
  }

  async extractResponse(page) {
    // Get the last assistant message (skip earlier ones from this thread)
    const selectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
      ".markdown",
    ];

    for (const sel of selectors) {
      const elements = await page.$$(sel);
      if (elements.length > 0) {
        // Get the most recent response
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

module.exports = ChatGPTAgent;
