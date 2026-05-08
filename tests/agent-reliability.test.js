const test = require("node:test");
const assert = require("node:assert/strict");

const ChatGPTAgent = require("../agents/chatgpt-agent");
const CopilotAgent = require("../agents/copilot-agent");
const GrokAgent = require("../agents/grok-agent");
const PerplexityAgent = require("../agents/perplexity-agent");

test("Copilot truncates oversized prompts to 9800 chars while preserving the prompt head and tail", async () => {
  const agent = new CopilotAgent({ sessionsDir: "." });
  const logs = [];
  agent.onLog = (line) => logs.push(line);

  const prefix = "You are @copilot in a council of AI advisors.\nThe user asked: \"Prompt parity?\"\n\nHere are the other agents' opening statements:\n\n";
  const body = `@o3: "${"A".repeat(7000)}"\n\n@gemini: "${"B".repeat(6000)}"\n\n`;
  const suffix = "Reply to every other agent separately using this exact section format:\n\nTo @o3:\n2-4 sentences.\n\nTo @gemini:\n2-4 sentences.";
  const prompt = `${prefix}${body}${suffix}`;

  const prepared = await agent.preparePrompt(prompt);

  assert.equal(prepared.text.length, 9800);
  assert.ok(prepared.text.startsWith(prefix));
  assert.ok(prepared.text.endsWith(suffix));
  assert.match(prepared.text, /\[\.\.\. middle truncated for Copilot limit \.\.\.\]/);
  assert.ok(logs.some((line) => line.includes("[copilot] Prompt truncated:")));
});

test("Grok input falls back from fill to keyboard to evaluate without using clipboard paste", async () => {
  const agent = new GrokAgent({ sessionsDir: "." });
  const calls = [];

  const locator = {
    fill: async () => {
      calls.push("fill");
      throw new Error("fill failed");
    },
    click: async () => {
      calls.push("click");
    },
  };
  const page = {
    locator: () => ({
      first: () => locator,
    }),
    keyboard: {
      press: async (key) => {
        calls.push(`press:${key}`);
      },
      type: async () => {
        calls.push("type");
        throw new Error("type failed");
      },
    },
    evaluate: async () => {
      calls.push("evaluate");
    },
  };

  const result = await agent.fillInput(page, 'textarea[aria-label="Ask Grok anything"]', "hello");

  assert.equal(result, true);
  assert.deepEqual(calls, [
    "fill",
    "click",
    "press:Control+A",
    "press:Backspace",
    "type",
    "evaluate",
  ]);
});

test("ChatGPT waits for the completion indicator after streaming begins", async () => {
  class FakeChatGPTAgent extends ChatGPTAgent {
    constructor(frames) {
      super({
        handle: "o3",
        name: "ChatGPT o3-pro",
        siteUrl: "https://chatgpt.com",
        sessionsDir: ".",
        model: "o3-pro",
      });
      this.frames = frames;
      this.index = 0;
      this.page = {
        waitForTimeout: async () => {
          if (this.index < this.frames.length - 1) {
            this.index++;
          }
        },
      };
    }

    async readCompletionControls() {
      return this.frames[this.index].controls;
    }

    async _readLatestResponse() {
      return this.frames[this.index].text;
    }
  }

  const agent = new FakeChatGPTAgent([
    {
      controls: { stopVisible: false, sendEnabled: true, sendDisabled: false },
      text: "",
    },
    {
      controls: { stopVisible: true, sendEnabled: false, sendDisabled: true },
      text: "draft",
    },
    {
      controls: { stopVisible: true, sendEnabled: false, sendDisabled: true },
      text: "draft plus more",
    },
    {
      controls: { stopVisible: false, sendEnabled: true, sendDisabled: false },
      text: "final",
    },
  ]);

  const result = await agent.waitForCompletionSignal();

  assert.equal(result.status, "detected");
  assert.equal(agent.index, 3);
});

test("Perplexity dismisses a sign-up overlay before clicking send", async () => {
  class FakePerplexityAgent extends PerplexityAgent {
    constructor() {
      super({ sessionsDir: "." });
      this.overlayChecks = 0;
    }

    async dismissSignupOverlay() {
      this.overlayChecks++;
      return true;
    }
  }

  const agent = new FakePerplexityAgent();
  const logs = [];
  agent.onLog = (line) => logs.push(line);

  const input = {
    click: async () => {},
    fill: async () => {},
  };
  const submit = {
    clicks: 0,
    click: async function () {
      this.clicks++;
    },
  };
  const page = {
    $: async (selector) => {
      if (selector === "textarea[placeholder]") {
        return input;
      }
      if (selector === 'button[aria-label="Submit"]') {
        return submit;
      }
      return null;
    },
    waitForTimeout: async () => {},
    keyboard: {
      press: async () => {},
    },
  };

  await agent.typeAndSubmit(page, "hello");

  assert.equal(submit.clicks, 1);
  assert.equal(agent.overlayChecks, 1);
  assert.ok(logs.some((line) => line.includes("[sonar] Dismissed sign-up overlay, retrying send.")));
});
