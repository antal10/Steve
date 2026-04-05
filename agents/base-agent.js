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
    this.sessionsDir = path.resolve(sessionsDir);
    this.context = null;
    this.page = null;
    this.onLog = () => {};
    this._hasNavigated = false;     // Track if we've already loaded the site
    this._responseBaseline = "";
    this._latestFreshResponse = "";
    this._awaitingFreshResponse = false;
    this._lastPromptDispatch = null;
    this._expectingClose = false;
    this._lastCloseCaller = "";
    this._observedPages = new Set();
    this._browser = null;
  }

  log(msg) {
    this.onLog(`[@${this.handle}] ${msg}`);
  }

  _safePageUrl(page = this.page) {
    try {
      if (!page || typeof page.url !== "function") {
        return "unavailable";
      }

      return page.url() || "about:blank";
    } catch (_) {
      return "unavailable";
    }
  }

  _safeOpenPageCount(context = this.context) {
    try {
      if (!context || typeof context.pages !== "function") {
        return "unavailable";
      }

      return context.pages().filter((page) => {
        try {
          return !page.isClosed();
        } catch (_) {
          return true;
        }
      }).length;
    } catch (_) {
      return "unavailable";
    }
  }

  _captureCallSite(methodName) {
    const stack = String(new Error().stack || "")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^at\s+/, ""))
      .filter(Boolean);

    for (const line of stack.slice(2)) {
      if (
        line.includes("agents/base-agent.js")
        || line.includes("agents\\base-agent.js")
        || line.includes(`.${methodName} (`)
        || line.includes(`.${methodName}(`)
      ) {
        continue;
      }

      return line;
    }

    return "unknown";
  }

  _formatLifecycleContext({ page = this.page, context = this.context, trackedPage } = {}) {
    const parts = [
      `closure=${this._expectingClose ? "expected" : "unexpected"}`,
      `url=${this._safePageUrl(page)}`,
      `open_pages=${this._safeOpenPageCount(context)}`,
    ];

    if (typeof trackedPage === "boolean") {
      parts.push(`tracked_page=${trackedPage}`);
    }

    if (this._lastCloseCaller) {
      parts.push(`close_caller=${this._lastCloseCaller}`);
    }

    return parts.join(", ");
  }

  _attachPageLifecycle(page) {
    if (!page || this._observedPages.has(page)) {
      return;
    }

    this._observedPages.add(page);

    page.on("close", () => {
      this.log(`Page close observed (${this._formatLifecycleContext({ page, trackedPage: page === this.page })}).`);
    });

    page.on("crash", () => {
      this.log(`Page crash observed (${this._formatLifecycleContext({ page, trackedPage: page === this.page })}).`);
    });
  }

  _attachLifecycleInstrumentation() {
    if (!this.context) {
      return;
    }

    this.context.on("page", (page) => {
      this._attachPageLifecycle(page);
    });

    this.context.on("close", () => {
      this.log(`Context close observed (${this._formatLifecycleContext()}).`);
    });

    for (const page of this.context.pages()) {
      this._attachPageLifecycle(page);
    }

    if (typeof this.context.browser === "function") {
      this._browser = this.context.browser();
      if (this._browser) {
        this._browser.on("disconnected", () => {
          this.log(`Browser disconnect observed (${this._formatLifecycleContext()}).`);
        });
      }
    }
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
    this._attachLifecycleInstrumentation();
    this._hasNavigated = false;
    this.log("Browser launched.");
  }

  async close() {
    const closeCaller = this._captureCallSite("close");
    this._expectingClose = true;
    this._lastCloseCaller = closeCaller;

    this.log(`close() requested (${this._formatLifecycleContext()}).`);

    try {
      if (this.context) {
        await this.context.close();
        this.log(`close() completed (${this._formatLifecycleContext()}).`);
      }
    } catch (err) {
      this.log(`Error closing browser: ${err.message} (${this._formatLifecycleContext()}).`);
    }
    this.context = null;
    this.page = null;
    this._browser = null;
    this._observedPages = new Set();
    this._hasNavigated = false;
    this._responseBaseline = "";
    this._latestFreshResponse = "";
    this._awaitingFreshResponse = false;
    this._lastPromptDispatch = null;
    this._expectingClose = false;
    this._lastCloseCaller = "";
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

    const preparedPrompt = await this.preparePrompt(text);
    const promptText = typeof preparedPrompt === "string"
      ? preparedPrompt
      : String(preparedPrompt?.text || "");
    const promptMeta = typeof preparedPrompt === "string"
      ? {}
      : { ...(preparedPrompt?.meta || {}) };

    this._lastPromptDispatch = {
      timestamp: new Date().toISOString(),
      original_text: String(text),
      original_chars: String(text).length,
      sent_text: promptText,
      sent_chars: promptText.length,
      truncated: promptText !== String(text),
      ...promptMeta,
    };

    this._responseBaseline = await this._readLatestResponse();
    this._latestFreshResponse = "";
    this._awaitingFreshResponse = true;

    await this.typeAndSubmit(this.page, promptText);
    this.log("Prompt submitted. Waiting for response...");
    return this.getLastPromptDispatch();
  }

  getLastPromptDispatch() {
    return this._lastPromptDispatch ? { ...this._lastPromptDispatch } : null;
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

    const completionSignal = await this.waitForCompletionSignal();
    const start = Date.now();
    let lastText = "";
    let stableCount = 0;

    while (Date.now() - start < GLOBAL_TIMEOUT) {
      try {
        await this.page.waitForTimeout(POLL_INTERVAL);
      } catch (err) {
        this.log(`waitForResponse polling failed: ${err.message} (${this._formatLifecycleContext()}).`);
        throw err;
      }

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
          return {
            status: "complete",
            completion_signal: completionSignal?.status || "not_applicable",
            fresh_response_detected: true,
          };
        }
      } else {
        stableCount = 0;
        lastText = currentText;
      }
    }

    if (this._latestFreshResponse) {
      this.log("Response timed out after 120s - using latest partial response.");
      return {
        status: "partial",
        completion_signal: completionSignal?.status || "not_applicable",
        fresh_response_detected: true,
      };
    }

    this.log("Response timed out after 120s - no fresh response detected.");
    return {
      status: "timeout",
      completion_signal: completionSignal?.status || "not_applicable",
      fresh_response_detected: false,
    };
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

  async preparePrompt(text) {
    return { text: String(text), meta: {} };
  }

  async waitForCompletionSignal() {
    return { status: "not_applicable" };
  }

  async typeAndSubmit(page, text) {
    throw new Error("Subclass must implement typeAndSubmit()");
  }

  async extractResponse(page) {
    throw new Error("Subclass must implement extractResponse()");
  }
}

module.exports = BaseAgent;
