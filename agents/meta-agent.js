const BaseAgent = require("./base-agent");

/**
 * Meta AI agent driver - @meta on meta.ai
 *
 * Live DOM inspected on 2026-03-31:
 *   Initial input:   input[placeholder="Ask anything..."]
 *   Follow-up input: input[placeholder="Ask a follow up..."]
 *   Send button:     button[aria-label="Send"]
 *   Age gate:        [role="dialog"] with
 *                    button[role="combobox"][aria-label="Year"],
 *                    [role="option"]:has-text("1990"),
 *                    button:has-text("Continue")
 *   Response:        [data-testid="assistant-message"] .markdown-content
 */
class MetaAgent extends BaseAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "meta",
      name: "Meta AI",
      siteUrl: "https://www.meta.ai",
      sessionsDir,
    });
  }

  async typeAndSubmit(page, text) {
    let input = await page.$('input[placeholder="Ask a follow up..."]');
    if (!input) {
      input = await page.$('input[placeholder="Ask anything..."]');
    }

    if (!input) {
      throw new Error("Could not find Meta AI input element");
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

    const sendBtn = await page.$('button[aria-label="Send"]');
    if (!sendBtn) {
      throw new Error("Could not find Meta AI send button");
    }

    await sendBtn.click();
    await page.waitForTimeout(500);

    const handledBirthdayGate = await this.completeBirthdayGate(page);
    if (handledBirthdayGate) {
      const followUpInput = await page.$('input[placeholder="Ask a follow up..."]');
      const threadAdvanced = /\/prompt\//.test(page.url()) || Boolean(followUpInput);

      if (!threadAdvanced) {
        const retrySendBtn = await page.$('button[aria-label="Send"]');
        if (retrySendBtn) {
          await retrySendBtn.click();
          await page.waitForTimeout(500);
        }
      }
    }

    this.log("Prompt sent via Meta AI interface.");
  }

  async extractResponse(page) {
    const selectors = [
      '[data-testid="assistant-message"] .markdown-content',
      '[data-testid="assistant-message"]',
      '.ur-markdown.prose.prose-trimmed.citation-aware',
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

  async completeBirthdayGate(page) {
    const dialog = await page.$('[role="dialog"]');
    if (!dialog) {
      return false;
    }

    this.log("Birthday gate detected. Selecting year...");

    const yearCombo = await page.$('button[role="combobox"][aria-label="Year"]');
    if (!yearCombo) {
      return;
    }

    await yearCombo.click();
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 });

    const yearOption = await page.$('[role="option"]:has-text("1990")');
    if (!yearOption) {
      throw new Error("Could not find Meta AI birth year option");
    }
    await yearOption.click();

    const continueBtn = await page.$('button:has-text("Continue")');
    if (!continueBtn) {
      throw new Error("Could not find Meta AI continue button");
    }
    await continueBtn.click();

    try {
      await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 });
    } catch (_) {
      /* dialog may unmount instead of transitioning */
    }

    await page.waitForTimeout(1500);
    return true;
  }
}

module.exports = MetaAgent;
