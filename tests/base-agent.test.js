const test = require("node:test");
const assert = require("node:assert/strict");

const BaseAgent = require("../agents/base-agent");

class FakeAgent extends BaseAgent {
  constructor(responses) {
    super({
      handle: "fake",
      name: "Fake Agent",
      siteUrl: "https://example.com",
      sessionsDir: ".",
    });
    this.responses = responses.slice();
    this.lastResponse = "";
    this.page = {
      waitForTimeout: async () => {},
    };
    this._hasNavigated = true;
  }

  async typeAndSubmit() {}

  async extractResponse() {
    if (this.responses.length > 0) {
      this.lastResponse = this.responses.shift();
    }

    return this.lastResponse;
  }
}

test("BaseAgent waits for a fresh response before extracting", async () => {
  const agent = new FakeAgent([
    "previous turn",
    "previous turn",
    "new draft",
    "new final",
    "new final",
    "new final",
    "new final",
  ]);

  await agent.sendPrompt("follow-up prompt");
  await agent.waitForResponse();
  const response = await agent.getResponse();

  assert.equal(response, "new final");
});

test("BaseAgent returns empty text when no fresh response appears", async () => {
  const agent = new FakeAgent([
    "same text",
    "same text",
    "same text",
  ]);

  await agent.sendPrompt("follow-up prompt");
  const response = await agent.getResponse();

  assert.equal(response, "");
});
