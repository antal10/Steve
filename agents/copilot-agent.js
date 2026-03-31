const BaseAgent = require("./base-agent");

/**
 * Copilot agent driver — @copilot on copilot.microsoft.com
 *
 * No login required for basic usage.
 *
 * Selectors target copilot.microsoft.com (March 2026):
 *   Input:    textarea or contenteditable in the chat input area
 *   Send:     submit button or Enter key
 *   Response: assistant message container
 *
 * Uses clipboard paste. Stays in thread for follow-ups.
 */
class CopilotAgent extends BaseAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "copilot",
      name: "Microsoft Copilot",
      siteUrl: "https://copilot.microsoft.com",
      sessionsDir,
    });
  }

  async typeAndSubmit(page, text) {
    // Copilot uses a textarea or contenteditable input
    let input = await page.$("#userInput");
    if (!input) {
      input = await page.$("textarea[placeholder]");
    }
    if (!input) {
      input = await page.$("textarea");
    }
    if (!input) {
      input = await page.$('[contenteditable="true"]');
    }

    if (!input) {
      throw new Error("Could not find Copilot input element");
    }

    // Use fill for textarea, clipboard paste as fallback
    try {
      await input.click();
      await page.waitForTimeout(200);
      await input.fill(text);
    } catch (e) {
      this.log("fill() failed, trying clipboard paste...");
      await this.clipboardPaste(page, input, text);
    }

    await page.waitForTimeout(300);

    // Try send button
    const sendBtn = await page.$('button[aria-label="Submit"]')
      || await page.$('button[aria-label="Send"]')
      || await page.$('button[type="submit"]')
      || await page.$('button[data-testid="send-button"]');

    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    this.log("Prompt sent via Copilot interface.");
  }

  async extractResponse(page) {
    // Copilot renders responses in assistant message containers
    const selectors = [
      '[data-content="ai-message"]',
      ".response-message-content",
      '[class*="assistant"]',
      '[class*="response"]',
      ".cib-message-content",
      ".ac-textBlock",
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

module.exports = CopilotAgent;
