const BaseAgent = require("./base-agent");

/**
 * Perplexity agent driver — @sonar on perplexity.ai
 *
 * Selectors target perplexity.ai (March 2026):
 *   Input:    textarea[placeholder] in the search/ask area
 *   Send:     Enter key or submit button
 *   Response: answer block below the query
 *
 * Uses clipboard paste. Stays in thread for follow-ups.
 */
class PerplexityAgent extends BaseAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "sonar",
      name: "Perplexity Sonar",
      siteUrl: "https://perplexity.ai",
      sessionsDir,
    });
  }

  async typeAndSubmit(page, text) {
    // Look for the textarea input
    let input = await page.$("textarea[placeholder]");
    if (!input) {
      input = await page.$("textarea");
    }
    if (!input) {
      input = await page.$('[contenteditable="true"]');
    }

    if (!input) {
      throw new Error("Could not find Perplexity input element");
    }

    // Use fill for textareas (works reliably), clipboard paste as fallback
    try {
      await input.click();
      await page.waitForTimeout(200);
      await input.fill(text);
    } catch (e) {
      this.log("fill() failed, trying clipboard paste...");
      await this.clipboardPaste(page, input, text);
    }

    await page.waitForTimeout(300);

    // Try submit button or Enter
    const submitBtn = await page.$('button[aria-label="Submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    this.log("Prompt sent via Perplexity interface.");
  }

  async extractResponse(page) {
    // Perplexity renders answers in a prose block
    const selectors = [
      ".prose",
      '[class*="answer"]',
      '[class*="result"]',
      ".markdown-content",
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

module.exports = PerplexityAgent;
