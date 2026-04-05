/**
 * deliberation.js - builds deliberation prompts and parses cross-reply responses.
 */

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHeadingPatterns(handle) {
  const escapedHandle = escapeRegex(handle);
  const prefixes = [
    "",
    "to\\s+",
    "for\\s+",
    "reply\\s+to\\s+",
    "replying\\s+to\\s+",
    "regarding\\s+",
    "re\\s*",
  ];

  return prefixes.map((prefix) => {
    const marker = String.raw`^\s*(?:[-*]\s*|#{1,6}\s*|\d+[\.\)]\s*)*(?:\*\*|__)?${prefix}@${escapedHandle}\b(?:\*\*|__)?\s*(?::|-|–|—)?\s*`;
    return new RegExp(marker, "i");
  });
}

function detectReplyHeading(line, handles) {
  for (const handle of handles) {
    const patterns = buildHeadingPatterns(handle);
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          targetHandle: handle,
          remainder: line.slice(match[0].length).trim(),
        };
      }
    }
  }

  return null;
}

function splitIntoParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function makeReplyPost(authorHandle, targetHandle, content, basePostId, index, timestamp) {
  const cleanContent = content.trim();
  return {
    post_id: `${basePostId}${String(index).padStart(3, "0")}`,
    author: `@${authorHandle}`,
    stage: "deliberation",
    type: "reply",
    reply_to: `@${targetHandle}`,
    timestamp,
    latency_seconds: 0,
    content: cleanContent,
    word_count: cleanContent.split(/\s+/).filter(Boolean).length,
  };
}

function remapSingleSelfTarget(authorHandle, expectedHandles, contentByTarget) {
  const normalized = new Map(contentByTarget);
  const unexpectedTargets = [...normalized.keys()].filter((target) => !expectedHandles.includes(target));
  const missingTargets = expectedHandles.filter((target) => !normalized.has(target));

  if (
    unexpectedTargets.length === 1
    && unexpectedTargets[0] === authorHandle
    && missingTargets.length === 1
    && normalized.size === expectedHandles.length
  ) {
    const selfReply = normalized.get(authorHandle);
    normalized.delete(authorHandle);
    normalized.set(missingTargets[0], selfReply);
  }

  return normalized;
}

/**
 * Build the deliberation prompt for a single agent.
 * The agent receives all other agents' opening statements and must reply to each.
 *
 * @param {string} agentHandle   - handle of the replying agent (e.g. "o3")
 * @param {string} prompt        - the user's original prompt
 * @param {Array}  otherPosts    - opening statement posts from other agents
 * @returns {string}             - the full deliberation prompt text
 */
function buildDeliberationPrompt(agentHandle, prompt, otherPosts) {
  const requiredTargets = otherPosts.map((post) => post.author).join(", ");

  let text = `You are @${agentHandle} in a council of AI advisors.\n`;
  text += `The user asked: "${prompt}"\n\n`;
  text += "Here are the other agents' opening statements:\n\n";

  for (const post of otherPosts) {
    text += `${post.author}: "${post.content}"\n\n`;
  }

  text += "Reply to every other agent separately using this exact section format:\n\n";
  for (const post of otherPosts) {
    text += `To ${post.author}:\n`;
    text += "2-4 sentences that start with agreement, then disagreement or gaps.\n\n";
  }

  text += `Required targets: ${requiredTargets}\n`;
  text += "- Include each target exactly once.\n";
  text += "- Keep each reply under its own heading.\n";
  text += "- No tables, no bullet lists, no combined replies.";

  return text;
}

/**
 * Parse a deliberation response into individual reply posts.
 * Accepts headings such as:
 *   To @agent:
 *   @agent:
 *   Reply to @agent -
 *   - @agent:
 *
 * @param {string} authorHandle  - the agent who wrote the response (e.g. "o3")
 * @param {string} response      - the full response text
 * @param {Array}  otherHandles  - handles of the other agents (e.g. ["gemini", "copilot", "claude", "sonar"])
 * @param {string} basePostId    - base post ID prefix for numbering
 * @param {number} startIndex    - starting post index
 * @returns {object}             - parsed reply posts plus missing-target metadata
 */
function parseDeliberationResponse(authorHandle, response, otherHandles, basePostId, startIndex) {
  const posts = [];
  const now = new Date().toISOString();
  const sections = [];
  const lines = response.split(/\r?\n/);
  const candidateHandles = otherHandles.includes(authorHandle)
    ? otherHandles.slice()
    : [...otherHandles, authorHandle];
  let currentSection = null;

  for (const line of lines) {
    const heading = detectReplyHeading(line, candidateHandles);
    if (heading) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        targetHandle: heading.targetHandle,
        lines: heading.remainder ? [heading.remainder] : [],
      };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  const mergedByTarget = new Map();
  for (const section of sections) {
    const content = section.lines.join("\n").trim();
    if (!content) {
      continue;
    }

    if (mergedByTarget.has(section.targetHandle)) {
      const existing = mergedByTarget.get(section.targetHandle);
      mergedByTarget.set(section.targetHandle, `${existing}\n\n${content}`.trim());
    } else {
      mergedByTarget.set(section.targetHandle, content);
    }
  }

  const normalizedTargets = remapSingleSelfTarget(authorHandle, otherHandles, mergedByTarget);

  for (const [targetHandle, content] of normalizedTargets.entries()) {
    posts.push(
      makeReplyPost(authorHandle, targetHandle, content, basePostId, startIndex + posts.length, now)
    );
  }

  if (posts.length === 0) {
    const cleanResponse = response.trim();
    if (cleanResponse && otherHandles.length === 1) {
      posts.push(
        makeReplyPost(authorHandle, otherHandles[0], cleanResponse, basePostId, startIndex, now)
      );

      return {
        posts,
        parse_mode: "single_target_fallback",
        missing_targets: [],
      };
    }

    return {
      posts: [],
      parse_mode: "unparsed",
      missing_targets: otherHandles.slice(),
    };
  }

  const addressed = new Set(posts.map((post) => post.reply_to.replace("@", "")));
  const missingTargets = otherHandles.filter((handle) => !addressed.has(handle));

  return {
    posts,
    parse_mode: sections.length > 0 ? "headed" : "merged",
    missing_targets: missingTargets,
  };
}

module.exports = { buildDeliberationPrompt, parseDeliberationResponse };

