const BaseAgent = require("./base-agent");

const META_COMPOSER_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][data-lexical-editor="true"]',
  'textarea[placeholder="Ask a follow up..."]',
  'textarea[placeholder="Ask anything..."]',
  'input[placeholder="Ask a follow up..."]',
  'input[placeholder="Ask anything..."]',
];
const META_FOLLOW_UP_SELECTORS = [
  'textarea[placeholder="Ask a follow up..."]',
  'input[placeholder="Ask a follow up..."]',
];
const META_SEND_BUTTON_SELECTOR = 'button[aria-label="Send"]';

function normalizeComposerText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

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

  async resolveComposer(page) {
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const selector of META_COMPOSER_SELECTORS) {
        const candidates = page.locator(selector);
        const count = await candidates.count();

        for (let index = 0; index < count; index++) {
          const locator = candidates.nth(index);
          const descriptor = await this.inspectComposer(locator, selector, index);
          if (descriptor) {
            return {
              locator,
              descriptor,
            };
          }
        }
      }

      if (attempt < 2) {
        await page.waitForTimeout(250);
      }
    }

    return null;
  }

  async inspectComposer(locator, selector, index) {
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      return null;
    }

    return locator.evaluate((node, meta) => {
      const tagName = String(node.tagName || "").toLowerCase();
      const disabled = "disabled" in node ? Boolean(node.disabled) : node.getAttribute("aria-disabled") === "true";
      const readOnly = "readOnly" in node ? Boolean(node.readOnly) : false;
      const contentEditable = Boolean(node.isContentEditable);
      const editable = !disabled && !readOnly && (
        tagName === "input"
        || tagName === "textarea"
        || contentEditable
      );

      if (!editable) {
        return null;
      }

      return {
        selector: meta.selector,
        index: meta.index,
        tagName,
        contentEditable,
      };
    }, { selector, index }).catch(() => null);
  }

  async readComposerText(composer) {
    return composer.locator.evaluate((node) => {
      const tagName = String(node.tagName || "").toLowerCase();
      if (tagName === "input" || tagName === "textarea") {
        return node.value || "";
      }

      return node.innerText || node.textContent || "";
    });
  }

  async setComposerText(composer, text) {
    await composer.locator.evaluate((node, value) => {
      const nextValue = String(value || "");
      const tagName = String(node.tagName || "").toLowerCase();

      node.focus();

      if (tagName === "input" || tagName === "textarea") {
        node.value = nextValue;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }

      if (node.isContentEditable) {
        node.textContent = nextValue;
        node.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: nextValue,
        }));
      }
    }, text);
  }

  async verifyComposerText(composer, text) {
    const expected = normalizeComposerText(text);

    for (let attempt = 0; attempt < 3; attempt++) {
      const actual = normalizeComposerText(await this.readComposerText(composer));
      if (actual === expected || actual.includes(expected)) {
        return true;
      }

      if (attempt < 2) {
        await this.page.waitForTimeout(150);
      }
    }

    return false;
  }

  async populateComposer(page, text) {
    const composer = await this.resolveComposer(page);
    if (!composer) {
      throw new Error("Could not find Meta AI input element");
    }

    const descriptor = `${composer.descriptor.tagName}${composer.descriptor.contentEditable ? "[contenteditable]" : ""} via ${composer.descriptor.selector}`;
    this.log(`Using Meta composer ${descriptor}.`);

    await composer.locator.scrollIntoViewIfNeeded().catch(() => {});

    try {
      await composer.locator.fill(text, { timeout: 5000 });
    } catch (_) {
      this.log(`Meta composer fill() failed for ${composer.descriptor.selector}; trying direct set...`);
      await this.setComposerText(composer, text);
    }

    if (!(await this.verifyComposerText(composer, text))) {
      await this.setComposerText(composer, text);
      if (!(await this.verifyComposerText(composer, text))) {
        throw new Error(`Meta composer text did not land in ${composer.descriptor.selector}`);
      }
    }

    return composer;
  }

  async resolveSendButton(page) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidates = page.locator(META_SEND_BUTTON_SELECTOR);
      const count = await candidates.count();

      for (let index = 0; index < count; index++) {
        const button = candidates.nth(index);
        const visible = await button.isVisible().catch(() => false);
        const enabled = await button.isEnabled().catch(() => false);
        if (visible && enabled) {
          return button;
        }
      }

      if (attempt < 2) {
        await page.waitForTimeout(250);
      }
    }

    return null;
  }

  async hasFollowUpComposer(page) {
    for (const selector of META_FOLLOW_UP_SELECTORS) {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible().catch(() => false);
      if (visible) {
        return true;
      }
    }

    return false;
  }

  async clickSendButton(page) {
    const sendBtn = await this.resolveSendButton(page);
    if (!sendBtn) {
      throw new Error("Could not find Meta AI send button");
    }

    await sendBtn.click({ timeout: 5000 });
  }

  async typeAndSubmit(page, text) {
    await this.populateComposer(page, text);
    await page.waitForTimeout(300);
    await this.clickSendButton(page);
    await page.waitForTimeout(500);

    const handledBirthdayGate = await this.completeBirthdayGate(page);
    if (handledBirthdayGate) {
      const threadAdvanced = /\/prompt\//.test(page.url()) || await this.hasFollowUpComposer(page);

      if (!threadAdvanced) {
        await this.populateComposer(page, text);
        await page.waitForTimeout(300);
        await this.clickSendButton(page);
        await page.waitForTimeout(500);
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
