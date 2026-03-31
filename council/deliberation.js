/**
 * deliberation.js — builds deliberation prompts and parses cross-reply responses.
 */

/**
 * Build the deliberation prompt for a single agent.
 * The agent receives all other agents' opening statements and must reply to each.
 *
 * @param {string} agentHandle   — handle of the replying agent (e.g. "o3")
 * @param {string} prompt        — the user's original prompt
 * @param {Array}  otherPosts    — opening statement posts from other agents
 * @returns {string}             — the full deliberation prompt text
 */
function buildDeliberationPrompt(agentHandle, prompt, otherPosts) {
  let text = `You are @${agentHandle} in a council of AI advisors.\n`;
  text += `The user asked: "${prompt}"\n\n`;
  text += `Here are the other agents' opening statements:\n\n`;

  for (const post of otherPosts) {
    text += `${post.author}: "${post.content}"\n\n`;
  }

  text += `Reply to each agent separately. For each reply:\n`;
  text += `- Start a new line with "To ${otherPosts.map((p) => p.author).join(':" or "To ')}:"\n`;
  text += `- Write 2–4 sentences\n`;
  text += `- Start with what you agree on, then state where you disagree or see gaps\n`;
  text += `- Be direct. No filler.`;

  return text;
}

/**
 * Parse a deliberation response into individual reply posts.
 * Splits on "To @agentname:" patterns.
 *
 * @param {string} authorHandle  — the agent who wrote the response (e.g. "o3")
 * @param {string} response      — the full response text
 * @param {Array}  otherHandles  — handles of the other agents (e.g. ["claude", "sonar", "codex"])
 * @param {string} basePostId    — base post ID prefix for numbering
 * @param {number} startIndex    — starting post index
 * @returns {Array}              — array of post objects
 */
function parseDeliberationResponse(authorHandle, response, otherHandles, basePostId, startIndex) {
  const posts = [];
  const now = new Date().toISOString();

  // Build regex to split on "To @handle:" patterns
  const handlePattern = otherHandles.map((h) => `@${h}`).join("|");
  const splitRegex = new RegExp(`To\\s+(${handlePattern})\\s*:`, "gi");

  // Find all split points
  const matches = [];
  let match;
  while ((match = splitRegex.exec(response)) !== null) {
    matches.push({ index: match.index, handle: match[1].toLowerCase(), end: match.index + match[0].length });
  }

  if (matches.length === 0) {
    // No structured replies found — create one post per other agent with the full response
    // divided evenly
    const lines = response.split("\n").filter((l) => l.trim());
    const perAgent = Math.max(1, Math.ceil(lines.length / otherHandles.length));

    for (let i = 0; i < otherHandles.length; i++) {
      const chunk = lines.slice(i * perAgent, (i + 1) * perAgent).join("\n").trim();
      const content = chunk || response.trim();
      const wordCount = content.split(/\s+/).filter(Boolean).length;

      posts.push({
        post_id: `${basePostId}${String(startIndex + i).padStart(3, "0")}`,
        author: `@${authorHandle}`,
        stage: "deliberation",
        type: "reply",
        reply_to: `@${otherHandles[i]}`,
        timestamp: now,
        latency_seconds: 0,
        content,
        word_count: wordCount,
      });
    }

    return posts;
  }

  // Extract text between split points
  for (let i = 0; i < matches.length; i++) {
    const textStart = matches[i].end;
    const textEnd = i + 1 < matches.length ? matches[i + 1].index : response.length;
    const content = response.slice(textStart, textEnd).trim();
    const targetHandle = matches[i].handle.replace("@", "");
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    posts.push({
      post_id: `${basePostId}${String(startIndex + i).padStart(3, "0")}`,
      author: `@${authorHandle}`,
      stage: "deliberation",
      type: "reply",
      reply_to: `@${targetHandle}`,
      timestamp: now,
      latency_seconds: 0,
      content,
      word_count: wordCount,
    });
  }

  // Fill in any agents not explicitly addressed
  const addressed = new Set(posts.map((p) => p.reply_to.replace("@", "")));
  for (const h of otherHandles) {
    if (!addressed.has(h)) {
      posts.push({
        post_id: `${basePostId}${String(startIndex + posts.length).padStart(3, "0")}`,
        author: `@${authorHandle}`,
        stage: "deliberation",
        type: "reply",
        reply_to: `@${h}`,
        timestamp: now,
        latency_seconds: 0,
        content: "(No explicit reply to this agent.)",
        word_count: 7,
      });
    }
  }

  return posts;
}

module.exports = { buildDeliberationPrompt, parseDeliberationResponse };
