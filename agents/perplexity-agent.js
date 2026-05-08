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
      let retriedAfterDismiss = false;

      if (await this.dismissSignupOverlay(page)) {
        this.onLog("[sonar] Dismissed sign-up overlay, retrying send.");
        retriedAfterDismiss = true;
      }

      try {
        await submitBtn.click();
      } catch (err) {
        if (!retriedAfterDismiss && await this.dismissSignupOverlay(page)) {
          this.onLog("[sonar] Dismissed sign-up overlay, retrying send.");
          await submitBtn.click();
        } else {
          throw err;
        }
      }
    } else {
      await page.keyboard.press("Enter");
    }

    this.log("Prompt sent via Perplexity interface.");
  }

  async dismissSignupOverlay(page) {
    const overlay = await this.findSignupOverlay(page);
    if (!overlay) {
      return false;
    }

    const closeSelectors = [
      'button[aria-label="Close"]',
      'button[aria-label="Dismiss"]',
      'button:has-text("Close")',
      'button:has-text("Dismiss")',
      'button:has-text("Not now")',
      'button:has-text("Maybe later")',
      'button:has-text("Skip")',
      'button:has-text("×")',
      'button:has-text("✕")',
    ];

    for (const selector of closeSelectors) {
      const button = overlay.locator(selector).first();
      if (await button.count()) {
        const visible = await button.isVisible().catch(() => false);
        if (visible) {
          await button.click().catch(() => {});
          if (await this.waitForOverlayToHide(overlay)) {
            return true;
          }
        }
      }
    }

    await page.keyboard.press("Escape").catch(() => {});
    if (await this.waitForOverlayToHide(overlay)) {
      return true;
    }

    await page.mouse.click(10, 10).catch(() => {});
    return this.waitForOverlayToHide(overlay);
  }

  async findSignupOverlay(page) {
    const overlaySelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="modal"]',
      '[class*="overlay"]',
    ];
    const signupPattern = /sign up|sign in|log in|login|create account|continue with/i;

    for (const selector of overlaySelectors) {
      const candidates = page.locator(selector);
      const count = Math.min(await candidates.count(), 5);

      for (let i = 0; i < count; i++) {
        const candidate = candidates.nth(i);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        const text = await candidate.innerText().catch(() => "");
        if (signupPattern.test(text)) {
          return candidate;
        }
      }
    }

    return null;
  }

  async waitForOverlayToHide(overlay) {
    try {
      await overlay.waitFor({ state: "hidden", timeout: 2000 });
      return true;
    } catch (_) {
      return !(await overlay.isVisible().catch(() => false));
    }
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
