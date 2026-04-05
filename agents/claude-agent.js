const BaseAgent = require("./base-agent");

const CLAUDE_RESPONSE_SELECTORS = [
  {
    label: "assistant-markdown",
    selector: ".font-claude-response .standard-markdown",
  },
  {
    label: "assistant-progressive-markdown",
    selector: ".font-claude-response .progressive-markdown",
  },
  {
    label: "assistant-body-paragraph",
    selector: "p.font-claude-response-body",
  },
  {
    label: "assistant-container",
    selector: ".font-claude-response",
  },
];

/**
 * Claude agent driver - @claude on claude.ai
 *
 * Selectors target claude.ai (April 2026):
 *   Input:    div.ProseMirror[contenteditable="true"] or fieldset .ProseMirror
 *   Send:     button[aria-label="Send Message"] or Enter key
 *   Response: .font-claude-response markdown containers
 *
 * Uses clipboard paste. Stays in thread for deliberation.
 */
class ClaudeAgent extends BaseAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "claude",
      name: "Claude",
      siteUrl: "https://claude.ai",
      sessionsDir,
    });
    this._lastResponseMatchLabel = "";
  }

  async typeAndSubmit(page, text) {
    // Try primary input selector
    let input = await page.$('div.ProseMirror[contenteditable="true"]');
    if (!input) {
      input = await page.$("fieldset .ProseMirror");
    }
    if (!input) {
      input = await page.$('[contenteditable="true"]');
    }

    if (!input) {
      throw new Error("Could not find Claude input element");
    }

    // Use clipboard paste instead of letter-by-letter typing
    try {
      await this.clipboardPaste(page, input, text);
    } catch (e) {
      this.log("Clipboard paste failed, trying direct paste...");
      await this.directPaste(page, input, text);
    }

    await page.waitForTimeout(300);

    // Try the send button first
    const sendBtn = await page.$('button[aria-label="Send Message"]');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    this.log("Prompt sent via Claude interface.");
  }

  async extractResponse(page) {
    for (const candidate of CLAUDE_RESPONSE_SELECTORS) {
      const match = await page.$$eval(candidate.selector, (nodes) => {
        const isVisible = (node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };

        for (let index = nodes.length - 1; index >= 0; index -= 1) {
          const node = nodes[index];
          if (!isVisible(node) || node.closest('[data-testid="user-message"]')) {
            continue;
          }

          const text = (node.innerText || node.textContent || "")
            .replace(/\u200B/g, "")
            .trim();

          if (!text) {
            continue;
          }

          return { index, text };
        }

        return null;
      });

      if (match?.text) {
        if (this._lastResponseMatchLabel !== candidate.label) {
          this._lastResponseMatchLabel = candidate.label;
          this.log(`Claude response matched via ${candidate.label} (${candidate.selector}).`);
        }
        return match.text;
      }
    }

    return "";
  }
}

module.exports = ClaudeAgent;
