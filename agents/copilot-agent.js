const BaseAgent = require("./base-agent");

const COPILOT_MAX_PROMPT_CHARS = 9800;
const COPILOT_TRUNCATION_MARKER = "\n\n[... middle truncated for Copilot limit ...]\n\n";
const BODY_TRUNCATION_MARKERS = [
  {
    start: "Here are the other agents' opening statements:\n\n",
    end: "\nReply to every other agent separately",
  },
  {
    start: "Here is the full council thread:\n\n",
    end: "\nReturn exactly one valid JSON object",
  },
];

function truncateMiddle(text, maxChars) {
  const keepChars = maxChars - COPILOT_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(keepChars / 2);
  const tailChars = Math.floor(keepChars / 2);
  return `${text.slice(0, headChars)}${COPILOT_TRUNCATION_MARKER}${text.slice(text.length - tailChars)}`;
}

function truncateBetweenMarkers(text, maxChars, markers) {
  const startIndex = text.indexOf(markers.start);
  if (startIndex === -1) {
    return null;
  }

  const bodyStart = startIndex + markers.start.length;
  const endIndex = text.indexOf(markers.end, bodyStart);
  if (endIndex === -1 || endIndex <= bodyStart) {
    return null;
  }

  const prefix = text.slice(0, bodyStart);
  const body = text.slice(bodyStart, endIndex);
  const suffix = text.slice(endIndex);
  const availableForBody = maxChars - prefix.length - suffix.length;

  if (availableForBody <= COPILOT_TRUNCATION_MARKER.length + 32) {
    return null;
  }

  return `${prefix}${truncateMiddle(body, availableForBody)}${suffix}`;
}

function truncateCopilotPrompt(text) {
  if (text.length <= COPILOT_MAX_PROMPT_CHARS) {
    return text;
  }

  for (const markers of BODY_TRUNCATION_MARKERS) {
    const truncated = truncateBetweenMarkers(text, COPILOT_MAX_PROMPT_CHARS, markers);
    if (truncated && truncated.length === COPILOT_MAX_PROMPT_CHARS) {
      return truncated;
    }
  }

  return truncateMiddle(text, COPILOT_MAX_PROMPT_CHARS);
}

/**
 * Copilot agent driver — @copilot on copilot.microsoft.com
 *
 * No login required for basic usage.
 *
 * Selectors target copilot.microsoft.com (March 2026):
 *   Input:    textarea or contenteditable in the chat input area
 *   Send:     submit button or Enter key
 *   Response: assistant message container
 *
 * Uses clipboard paste. Stays in thread for follow-ups.
 */
class CopilotAgent extends BaseAgent {
  constructor({ sessionsDir }) {
    super({
      handle: "copilot",
      name: "Microsoft Copilot",
      siteUrl: "https://copilot.microsoft.com",
      sessionsDir,
    });
  }

  async preparePrompt(text) {
    const originalText = String(text);
    const truncatedText = truncateCopilotPrompt(originalText);

    if (truncatedText !== originalText) {
      this.onLog(`[copilot] Prompt truncated: ${originalText.length} → ${COPILOT_MAX_PROMPT_CHARS} chars`);
    }

    return {
      text: truncatedText,
      meta: {
        truncation_limit: COPILOT_MAX_PROMPT_CHARS,
        truncated_from_chars: truncatedText === originalText ? null : originalText.length,
      },
    };
  }

  async typeAndSubmit(page, text) {
    // Copilot uses a textarea or contenteditable input
    let input = await page.$("#userInput");
    if (!input) {
      input = await page.$("textarea[placeholder]");
    }
    if (!input) {
      input = await page.$("textarea");
    }
    if (!input) {
      input = await page.$('[contenteditable="true"]');
    }

    if (!input) {
      throw new Error("Could not find Copilot input element");
    }

    // Use fill for textarea, clipboard paste as fallback
    try {
      await input.click();
      await page.waitForTimeout(200);
      await input.fill(text);
    } catch (e) {
      this.log("fill() failed, trying clipboard paste...");
      await this.clipboardPaste(page, input, text);
    }

    await page.waitForTimeout(300);

    // Try send button
    const sendBtn = await page.$('button[aria-label="Submit"]')
      || await page.$('button[aria-label="Send"]')
      || await page.$('button[type="submit"]')
      || await page.$('button[data-testid="send-button"]');

    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    this.log("Prompt sent via Copilot interface.");
  }

  async extractResponse(page) {
    // Copilot renders responses in assistant message containers
    const selectors = [
      '[data-content="ai-message"]',
      ".response-message-content",
      '[class*="assistant"]',
      '[class*="response"]',
      ".cib-message-content",
      ".ac-textBlock",
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

module.exports = CopilotAgent;
