const BaseAgent = require("./base-agent");

/**
 * Gemini agent driver — @gemini on gemini.google.com
 *
 * No login required for basic usage.
 *
 * Selectors target gemini.google.com (March 2026):
 *   Input:    rich text editor / contenteditable area or textarea
 *   Send:     send button or Enter key
 *   Response: model response turn container
 *
 * Uses clipboard paste. Stays in thread for follow-ups.
 */
class GeminiAgent extends BaseAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "gemini",
      name: "Gemini",
      siteUrl: "https://gemini.google.com/app",
      sessionsDir,
    });
  }

  async typeAndSubmit(page, text) {
    // Gemini uses a rich text editor area
    let input = await page.$('.ql-editor[contenteditable="true"]');
    if (!input) {
      input = await page.$('rich-textarea [contenteditable="true"]');
    }
    if (!input) {
      input = await page.$('[contenteditable="true"]');
    }
    if (!input) {
      input = await page.$("textarea");
    }

    if (!input) {
      throw new Error("Could not find Gemini input element");
    }

    // Use clipboard paste
    try {
      await this.clipboardPaste(page, input, text);
    } catch (e) {
      this.log("Clipboard paste failed, trying direct paste...");
      await this.directPaste(page, input, text);
    }

    await page.waitForTimeout(300);

    // Try send button
    const sendBtn = await page.$('button[aria-label="Send message"]')
      || await page.$('button.send-button')
      || await page.$('button[data-test-id="send-button"]')
      || await page.$('.send-button-container button');

    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    this.log("Prompt sent via Gemini interface.");
  }

  async extractResponse(page) {
    // Gemini renders responses in model-response turns
    const selectors = [
      "model-response .markdown",
      "model-response",
      ".response-container .markdown",
      'message-content[class*="model"]',
      ".conversation-container .model-response-text",
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

module.exports = GeminiAgent;
