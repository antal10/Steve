const BaseAgent = require("./base-agent");

/**
 * ChatGPT agent driver - used for the @o3 browser session.
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
    this.model = model; // currently "o3-pro"
  }

  async resolveSendButton(page, timeoutMs = 3000) {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
    ];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        const count = await locator.count().catch(() => 0);
        if (!count) {
          continue;
        }

        const visible = await locator.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        const enabled = await locator.isEnabled().catch(() => false);
        if (!enabled) {
          continue;
        }

        return { locator, selector };
      }

      await page.waitForTimeout(100);
    }

    return null;
  }

  async typeAndSubmit(page, text) {
    let input = await page.$("#prompt-textarea");
    if (!input) {
      input = await page.$('div[contenteditable="true"]');
    }

    if (!input) {
      throw new Error("Could not find ChatGPT input element");
    }

    try {
      await this.clipboardPaste(page, input, text);
    } catch (e) {
      this.log("Clipboard paste failed, trying direct paste...");
      await this.directPaste(page, input, text);
    }

    await page.waitForTimeout(300);

    const sendControl = await this.resolveSendButton(page);
    if (sendControl) {
      await sendControl.locator.click({ timeout: 1500 });
      this.log(`ChatGPT send used button locator (${sendControl.selector}).`);
    } else {
      await page.keyboard.press("Enter");
      this.log("ChatGPT send used Enter fallback.");
    }

    this.log("Prompt sent via ChatGPT interface.");
  }

  async waitForCompletionSignal() {
    const timeoutMs = 60000;
    const pollIntervalMs = 500;
    const startedAt = Date.now();
    let streamingStarted = false;

    while (Date.now() - startedAt < timeoutMs) {
      const controls = await this.readCompletionControls(this.page);
      const currentText = await this._readLatestResponse();
      const hasFreshResponse = currentText.length > 0 && currentText !== this._responseBaseline;

      if (!streamingStarted && (controls.stopVisible || hasFreshResponse || controls.sendDisabled)) {
        streamingStarted = true;
        this.log("Streaming detected. Waiting for completion indicator...");
      }

      if (streamingStarted && !controls.stopVisible && (controls.sendEnabled || hasFreshResponse)) {
        this.log("Streaming completion indicator detected.");
        return { status: "detected" };
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }

    this.log("Streaming completion indicator timed out after 60s. Falling back to stability check.");
    return { status: "timeout" };
  }

  async readCompletionControls(page) {
    const sendSelectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
    ];
    const stopSelectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop"]',
      'button[title*="Stop"]',
    ];

    const sendEnabled = await this.isAnyLocatorEnabled(page, sendSelectors);
    const stopVisible = await this.isAnyLocatorVisible(page, stopSelectors);

    return {
      sendEnabled,
      sendDisabled: !sendEnabled,
      stopVisible,
    };
  }

  async isAnyLocatorEnabled(page, selectors) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        return locator.isEnabled().catch(() => false);
      }
    }

    return false;
  }

  async isAnyLocatorVisible(page, selectors) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        const visible = await locator.isVisible().catch(() => false);
        if (visible) {
          return true;
        }
      }
    }

    return false;
  }

  async extractResponse(page) {
    const selectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
      ".markdown",
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

module.exports = ChatGPTAgent;
