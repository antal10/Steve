const BaseAgent = require("./base-agent");

/**
 * ChatGPT agent driver — used for both @o3 (o3-pro) and @codex models.
 *
 * Selectors target chatgpt.com (March 2026):
 *   Input:    #prompt-textarea or div[contenteditable="true"]
 *   Send:     button[data-testid="send-button"] or Enter key
 *   Response: .markdown in last assistant message, or [data-message-author-role="assistant"]
 */
class ChatGPTAgent extends BaseAgent {
  constructor({ handle, name, siteUrl, sessionsDir, model }) {
    super({ handle, name, siteUrl, sessionsDir });
    this.model = model; // "o3-pro" or "codex"
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

    await input.click();
    await page.waitForTimeout(300);

    // Type the text using keyboard to handle contenteditable divs
    await input.fill("");
    await page.waitForTimeout(100);

    // For contenteditable, use page.keyboard
    await input.click();
    for (const line of text.split("\n")) {
      await page.keyboard.type(line, { delay: 5 });
      await page.keyboard.press("Shift+Enter");
    }

    await page.waitForTimeout(300);

    // Try clicking the send button first
    const sendBtn = await page.$('button[data-testid="send-button"]');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    this.log("Prompt sent via ChatGPT interface.");
  }

  async extractResponse(page) {
    // Get the last assistant message
    const selectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
      ".markdown",
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

module.exports = ChatGPTAgent;
