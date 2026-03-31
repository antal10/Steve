const { chromium } = require("playwright");
const path = require("path");

/**
 * BaseAgent — shared Playwright driver logic for all council agents.
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
  }

  log(msg) {
    this.onLog(`[@${this.handle}] ${msg}`);
  }

  /* ── Lifecycle ────────────────────────────────────────── */

  async launch() {
    this.log(`Launching browser (persistent context)...`);
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
  }

  /* ── Core actions ─────────────────────────────────────── */

  /**
   * Send a prompt. On first call, navigates to the site.
   * On subsequent calls (deliberation), stays in the same thread.
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

    // Use clipboard to paste — much faster than keyboard.type()
    await page.evaluate(async (t) => {
      await navigator.clipboard.writeText(t);
    }, text);

    // Ctrl+V to paste
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+a`);  // Select all existing text
    await page.waitForTimeout(100);
    await page.keyboard.press(`${modifier}+v`);  // Paste
    await page.waitForTimeout(300);
  }

  /**
   * Fallback paste using page.evaluate to set value directly.
   * Used when clipboard API is blocked.
   */
  async directPaste(page, element, text) {
    await element.click();
    await page.waitForTimeout(200);

    // Try to set value via evaluate for contenteditable or textarea
    await page.evaluate(({ el, t }) => {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        el.value = t;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        // contenteditable
        el.textContent = t;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, { el: element, t: text });

    await page.waitForTimeout(300);
  }

  /**
   * Polls for response completion using text-stability check.
   * Text length must be unchanged for 3 consecutive checks (6s stable).
   * Global timeout: 120 seconds.
   */
  async waitForResponse() {
    const POLL_INTERVAL = 2000;
    const STABLE_THRESHOLD = 3;
    const GLOBAL_TIMEOUT = 120000;

    const start = Date.now();
    let lastLength = -1;
    let stableCount = 0;

    while (Date.now() - start < GLOBAL_TIMEOUT) {
      await this.page.waitForTimeout(POLL_INTERVAL);

      let currentText = "";
      try {
        currentText = await this.extractResponse(this.page);
      } catch (_) {
        /* response element may not exist yet */
      }

      const currentLength = currentText.length;

      if (currentLength > 0 && currentLength === lastLength) {
        stableCount++;
        if (stableCount >= STABLE_THRESHOLD) {
          this.log("Response stable — extraction ready.");
          return;
        }
      } else {
        stableCount = 0;
      }

      lastLength = currentLength;
    }

    this.log("Response timed out after 120s — extracting what we have.");
  }

  /**
   * Gets the final response text from the page.
   * Returns the text content.
   */
  async getResponse() {
    const text = await this.extractResponse(this.page);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    this.log(`Response extracted (${wordCount} words).`);
    return text;
  }

  /* ── Subclass overrides ───────────────────────────────── */

  async typeAndSubmit(page, text) {
    throw new Error("Subclass must implement typeAndSubmit()");
  }

  async extractResponse(page) {
    throw new Error("Subclass must implement extractResponse()");
  }
}

module.exports = BaseAgent;
