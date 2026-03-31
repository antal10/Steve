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
 *   async isResponseComplete(page)
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
  }

  /* ── Core actions ─────────────────────────────────────── */

  async sendPrompt(text) {
    this.log(`Navigating to ${this.siteUrl}...`);
    await this.page.goto(this.siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForTimeout(2000);
    this.log("Page loaded. Typing prompt...");
    await this.typeAndSubmit(this.page, text);
    this.log("Prompt submitted. Waiting for response...");
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
