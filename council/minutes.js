/**
 * minutes.js - builds the minutes prompt and parses structured minutes.
 */

const CONSENSUS_LEVELS = new Set(["strong", "moderate", "split", "unresolved"]);

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function stripCodeFences(text) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return text.trim();
}

/**
 * Build the minutes prompt from the full council thread.
 *
 * @param {string} prompt   - the user's original prompt
 * @param {Array}  posts    - all posts from stages 2 and 3
 * @param {Array}  agents   - active agent handles
 * @returns {string}        - the full minutes prompt
 */
function buildMinutesPrompt(prompt, posts, agents) {
  let text = "You are the secretary for an AI council session.\n";
  text += `The user's original question: "${prompt}"\n\n`;
  text += "Here is the full council thread:\n\n";

  text += "[OPENING STATEMENTS]\n";
  const openings = posts.filter((post) => post.stage === "opening");
  for (const post of openings) {
    text += `${post.author}: ${post.content}\n\n`;
  }

  text += "[DELIBERATION]\n";
  const deliberations = posts.filter((post) => post.stage === "deliberation");
  for (const post of deliberations) {
    text += `${post.author} (replying to ${post.reply_to}): ${post.content}\n\n`;
  }

  text += "Return exactly one valid JSON object with no markdown fences and no extra prose.\n";
  text += "Every array must contain concrete items pulled from the thread when available.\n";
  text += "If the council reached no agreement or no disagreement, return an empty array for that field.\n";
  text += "Use this exact schema and keep the key names unchanged:\n";
  text += "{\n";
  text += '  "points_of_agreement": ["..."],\n';
  text += '  "points_of_disagreement": ["..."],\n';
  text += '  "unresolved_questions": ["..."],\n';
  text += '  "recommended_next_action": "...",\n';
  text += '  "consensus_level": "strong|moderate|split|unresolved",\n';
  text += '  "raw_minutes_text": "A plain-English summary of the council session."\n';
  text += "}\n\n";
  text += "Do not answer as a participant in the debate. Do not repeat any \"To @agent\" reply headings.";

  return text;
}

/**
 * Parse the minutes response from the minutes agent.
 * Falls back to a default structure if JSON parsing fails.
 *
 * @param {string} response       - raw response from the minutes agent
 * @param {string} generatedBy    - handle of the agent that produced the minutes
 * @param {Array}  attendees      - list of active agent handles
 * @returns {object}              - structured minutes object matching SCHEMA.md
 */
function parseMinutesResponse(response, generatedBy, attendees) {
  const base = {
    generated_by: `@${generatedBy}`,
    attendees: attendees.map((agent) => `@${agent}`),
  };

  const cleanedResponse = stripCodeFences(response);
  let parsed = null;

  try {
    parsed = JSON.parse(cleanedResponse);
  } catch (_) {
    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {
        parsed = null;
      }
    }
  }

  if (parsed) {
    const consensusLevel = CONSENSUS_LEVELS.has(parsed.consensus_level)
      ? parsed.consensus_level
      : "unresolved";

    return {
      ...base,
      points_of_agreement: normalizeStringArray(parsed.points_of_agreement),
      points_of_disagreement: normalizeStringArray(parsed.points_of_disagreement),
      unresolved_questions: normalizeStringArray(parsed.unresolved_questions),
      recommended_next_action: String(parsed.recommended_next_action || "").trim(),
      consensus_level: consensusLevel,
      raw_minutes_text: String(parsed.raw_minutes_text || cleanedResponse).trim(),
    };
  }

  return {
    ...base,
    points_of_agreement: [],
    points_of_disagreement: [],
    unresolved_questions: [],
    recommended_next_action: "",
    consensus_level: "unresolved",
    raw_minutes_text: cleanedResponse,
  };
}

module.exports = { buildMinutesPrompt, parseMinutesResponse };
