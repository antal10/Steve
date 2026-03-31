const BaseAgent = require("./base-agent");

/**
 * Grok agent driver - @grok on grok.com
 *
 * Live DOM inspected on 2026-03-31:
 *   Input:    textarea[aria-label="Ask Grok anything"]
 *   Fallback: textarea[placeholder="What's on your mind?"]
 *   Send:     button[aria-label="Submit"]
 *   Response: div[id^="response-"].items-start .response-content-markdown
 */
class GrokAgent extends BaseAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "grok",
      name: "Grok",
      siteUrl: "https://grok.com",
      sessionsDir,
    });
  }

  async typeAndSubmit(page, text) {
    let input = await page.$('textarea[aria-label="Ask Grok anything"]');
    if (!input) {
      input = await page.$('textarea[placeholder="What\'s on your mind?"]');
    }
    if (!input) {
      input = await page.$("textarea");
    }

    if (!input) {
      throw new Error("Could not find Grok input element");
    }

    try {
      await input.click();
      await page.waitForTimeout(200);
      await input.fill(text);
    } catch (e) {
      this.log("fill() failed, trying clipboard paste...");
      await this.clipboardPaste(page, input, text);
    }

    await page.waitForTimeout(300);

    const sendBtn = await page.$('button[aria-label="Submit"]')
      || await page.$('button[type="submit"]');

    if (!sendBtn) {
      throw new Error("Could not find Grok submit button");
    }

    await sendBtn.waitForElementState("enabled", { timeout: 10000 }).catch(() => {});
    await sendBtn.click();
    this.log("Prompt sent via Grok interface.");
  }

  async extractResponse(page) {
    const selectors = [
      'div[id^="response-"].items-start .response-content-markdown',
      'div[id^="response-"].items-start .message-bubble',
      '#last-reply-container div[id^="response-"].items-start',
    ];

    for (const selector of selectors) {
      const elements = await page.$$(selector);
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

module.exports = GrokAgent;
