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
    const input = await this.findInput(page);
    if (!input) {
      throw new Error("Could not find Grok input element");
    }

    const inputFilled = await this.fillInput(page, input, text);
    if (!inputFilled) {
      throw new Error("All Grok input strategies failed");
    }

    await page.waitForTimeout(300);

    const sendBtn = await this.waitForSubmitButton(page);

    if (sendBtn) {
      await sendBtn.click();
      this.log("Prompt sent via Grok interface.");
      return;
    }

    await input.click().catch(() => {});
    await page.keyboard.press("Enter");
    this.log("Prompt sent via Grok interface (Enter fallback).");
  }

  async findInput(page) {
    return this.findVisibleLocator(page, [
      'div[contenteditable="true"].tiptap.ProseMirror',
      'div.tiptap.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][translate="no"]',
      '[contenteditable="true"]',
      'textarea[aria-label="Ask Grok anything"]',
      'textarea[placeholder="What\'s on your mind?"]',
      "textarea",
    ]);
  }

  async waitForSubmitButton(page, timeoutMs = 5000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const button = await this.findVisibleLocator(page, [
        'button[aria-label="Submit"]',
        'button[type="submit"]',
      ], { requireEnabled: true });

      if (button) {
        return button;
      }

      await page.waitForTimeout(100);
    }

    return null;
  }

  async findVisibleLocator(page, selectors, { requireEnabled = false } = {}) {

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);

      for (let index = 0; index < count; index++) {
        const candidate = locator.nth(index);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        if (requireEnabled) {
          const enabled = await candidate.isEnabled().catch(() => false);
          if (!enabled) {
            continue;
          }
        }

        return candidate;
      }
    }

    return null;
  }

  async fillInput(page, inputOrLocator, text) {
    const selector = typeof inputOrLocator === "string" ? inputOrLocator : null;
    const locator = selector
      ? page.locator(selector).first()
      : inputOrLocator;

    try {
      await locator.fill(text);
      if (await this.inputMatches(locator, text)) {
        return true;
      }
      this.log("locator.fill() did not update the visible Grok composer.");
    } catch (err) {
      this.log(`locator.fill() failed: ${err.message}`);
    }

    try {
      await locator.click();
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
      await page.keyboard.type(text, { delay: 15 });
      if (await this.inputMatches(locator, text)) {
        return true;
      }
      this.log("keyboard.type() did not update the visible Grok composer.");
    } catch (err) {
      this.log(`keyboard.type() fallback failed: ${err.message}`);
    }

    try {
      if (typeof locator.evaluate === "function") {
        await locator.evaluate((el, value) => {
          const nextValue = String(value || "");
          const tagName = String(el.tagName || "").toLowerCase();

          el.focus();

          if (el.isContentEditable) {
            el.textContent = nextValue;

            if (typeof InputEvent === "function") {
              el.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: nextValue,
              }));
            } else {
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }

            return;
          }

          const prototype = tagName === "input"
            ? window.HTMLInputElement.prototype
            : window.HTMLTextAreaElement.prototype;
          const nativeInput = Object.getOwnPropertyDescriptor(prototype, "value");

          if (!nativeInput || typeof nativeInput.set !== "function") {
            throw new Error("Native input setter unavailable");
          }

          nativeInput.set.call(el, nextValue);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }, text);

        if (await this.inputMatches(locator, text)) {
          return true;
        }
        this.log("locator.evaluate() did not update the visible Grok composer.");
      } else if (selector && typeof page.evaluate === "function") {
        await page.evaluate(({ inputSelector, value }) => {
          const el = document.querySelector(inputSelector);
          if (!el) {
            throw new Error("Input element not found");
          }

          const nextValue = String(value || "");
          const tagName = String(el.tagName || "").toLowerCase();

          el.focus();

          if (el.isContentEditable) {
            el.textContent = nextValue;

            if (typeof InputEvent === "function") {
              el.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: nextValue,
              }));
            } else {
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }

            return;
          }

          const prototype = tagName === "input"
            ? window.HTMLInputElement.prototype
            : window.HTMLTextAreaElement.prototype;
          const nativeInput = Object.getOwnPropertyDescriptor(prototype, "value");

          if (!nativeInput || typeof nativeInput.set !== "function") {
            throw new Error("Native input setter unavailable");
          }

          nativeInput.set.call(el, nextValue);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }, { inputSelector: selector, value: text });

        return true;
      }
    } catch (err) {
      this.log(`locator.evaluate() fallback failed: ${err.message}`);
    }

    return false;
  }

  async inputMatches(locator, text) {
    try {
      const currentValue = await locator.evaluate((el) => {
        if (typeof el.value === "string") {
          return el.value;
        }

        if (typeof el.innerText === "string" && el.innerText.length > 0) {
          return el.innerText;
        }

        return typeof el.textContent === "string" ? el.textContent : "";
      });

      return this.normalizeEditableText(currentValue) === this.normalizeEditableText(text);
    } catch (_) {
      return false;
    }
  }

  normalizeEditableText(value) {
    return String(value || "")
      .replace(/\u200B/g, "")
      .replace(/\r\n/g, "\n")
      .trim();
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
