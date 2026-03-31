const { chromium } = require("playwright");
const path = require("path");

/**
 * BaseAgent - shared Playwright driver logic for all council agents.
 *
 * Subclasses override:
 *   get inputSelector()
 *   get responseSelector()
 *   async typeAndSubmit(page, text)
 *   async extractResponse(page)
 */
class BaseAgent {
  constructor({ handle, name, siteUrl, sessionsDir }) {
    this.handle = handle;           // e.g. "o3"
    this.name = name;               // e.g. "ChatGPT o3-pro"
    this.siteUrl = siteUrl;
    this.sessionsDir = path.resolve(sessionsDir, handle);
    this.context = null;
    this.page = null;
    this.onLog = () => {};
    this._hasNavigated = false;     // Track if we've already loaded the site
    this._responseBaseline = "";
    this._latestFreshResponse = "";
    this._awaitingFreshResponse = false;
  }

  log(msg) {
    this.onLog(`[@${this.handle}] ${msg}`);
  }

  /* Lifecycle */

  async launch() {
    this.log("Launching browser (persistent context)...");
    this.context = await chromium.launchPersistentContext(this.sessionsDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    this.page = this.context.pages()[0] || (await this.context.newPage());
    this._hasNavigated = false;
    this.log("Browser launched.");
  }

  async close() {
    try {
      if (this.context) {
        await this.context.close();
        this.log("Browser closed.");
      }
    } catch (err) {
      this.log(`Error closing browser: ${err.message}`);
    }
    this.context = null;
    this.page = null;
    this._hasNavigated = false;
    this._responseBaseline = "";
    this._latestFreshResponse = "";
    this._awaitingFreshResponse = false;
  }

  /* Core actions */

  /**
   * Send a prompt. On first call, navigates to the site.
   * On subsequent calls (deliberation/minutes), stays in the same thread.
   */
  async sendPrompt(text) {
    if (!this._hasNavigated) {
      this.log(`Navigating to ${this.siteUrl}...`);
      await this.page.goto(this.siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(2000);
      this._hasNavigated = true;
      this.log("Page loaded. Typing prompt...");
    } else {
      this.log("Staying in thread. Typing follow-up...");
      await this.page.waitForTimeout(1000);
    }

    this._responseBaseline = await this._readLatestResponse();
    this._latestFreshResponse = "";
    this._awaitingFreshResponse = true;

    await this.typeAndSubmit(this.page, text);
    this.log("Prompt submitted. Waiting for response...");
  }

  /**
   * Clipboard-paste text into an element instead of typing letter-by-letter.
   * Works for both contenteditable divs and regular inputs/textareas.
   */
  async clipboardPaste(page, element, text) {
    await element.click();
    await page.waitForTimeout(200);

    await page.evaluate(async (t) => {
      await navigator.clipboard.writeText(t);
    }, text);

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+a`);
    await page.waitForTimeout(100);
    await page.keyboard.press(`${modifier}+v`);
    await page.waitForTimeout(300);
  }

  /**
   * Fallback paste using page.evaluate to set value directly.
   * Used when clipboard API is blocked.
   */
  async directPaste(page, element, text) {
    await element.click();
    await page.waitForTimeout(200);

    await page.evaluate(({ el, t }) => {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        el.value = t;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        el.textContent = t;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, { el: element, t: text });

    await page.waitForTimeout(300);
  }

  /**
   * Polls for response completion using exact text stability.
   * A response must differ from the previous assistant turn and stay
   * unchanged for 3 consecutive checks (6s stable).
   */
  async waitForResponse() {
    const POLL_INTERVAL = 2000;
    const STABLE_THRESHOLD = 3;
    const GLOBAL_TIMEOUT = 120000;

    const start = Date.now();
    let lastText = "";
    let stableCount = 0;

    while (Date.now() - start < GLOBAL_TIMEOUT) {
      await this.page.waitForTimeout(POLL_INTERVAL);

      const currentText = await this._readLatestResponse();
      const isFreshResponse = currentText.length > 0 && currentText !== this._responseBaseline;

      if (!isFreshResponse) {
        stableCount = 0;
        lastText = "";
        continue;
      }

      this._latestFreshResponse = currentText;

      if (currentText === lastText) {
        stableCount++;
        if (stableCount >= STABLE_THRESHOLD) {
          this.log("Response stable - extraction ready.");
          return;
        }
      } else {
        stableCount = 0;
        lastText = currentText;
      }
    }

    if (this._latestFreshResponse) {
      this.log("Response timed out after 120s - using latest partial response.");
      return;
    }

    this.log("Response timed out after 120s - no fresh response detected.");
  }

  /**
   * Gets the latest fresh response text from the page.
   */
  async getResponse() {
    let text = this._latestFreshResponse || await this._readLatestResponse();

    if (this._awaitingFreshResponse && text === this._responseBaseline) {
      this.log("Response extraction returned no fresh text.");
      text = "";
    }

    this._awaitingFreshResponse = false;
    this._latestFreshResponse = "";

    if (!text) {
      return "";
    }

    this._responseBaseline = text;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    this.log(`Response extracted (${wordCount} words).`);
    return text;
  }

  async _readLatestResponse() {
    try {
      return (await this.extractResponse(this.page)).trim();
    } catch (_) {
      return "";
    }
  }

  /* Subclass overrides */

  async typeAndSubmit(page, text) {
    throw new Error("Subclass must implement typeAndSubmit()");
  }

  async extractResponse(page) {
    throw new Error("Subclass must implement extractResponse()");
  }
}

module.exports = BaseAgent;
