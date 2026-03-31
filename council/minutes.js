/**
 * minutes.js — builds the minutes prompt and parses structured minutes.
 */

/**
 * Build the minutes prompt from the full council thread.
 *
 * @param {string} prompt   — the user's original prompt
 * @param {Array}  posts    — all posts from stages 2 and 3
 * @param {Array}  agents   — active agent handles
 * @returns {string}        — the full minutes prompt
 */
function buildMinutesPrompt(prompt, posts, agents) {
  let text = `You are the secretary for an AI council session.\n`;
  text += `The user's original question: "${prompt}"\n\n`;
  text += `Here is the full council thread:\n\n`;

  // Opening statements
  text += `[OPENING STATEMENTS]\n`;
  const openings = posts.filter((p) => p.stage === "opening");
  for (const post of openings) {
    text += `${post.author}: ${post.content}\n\n`;
  }

  // Deliberation
  text += `[DELIBERATION]\n`;
  const deliberations = posts.filter((p) => p.stage === "deliberation");
  for (const post of deliberations) {
    text += `${post.author} (replying to ${post.reply_to}): ${post.content}\n\n`;
  }

  text += `Produce structured meeting minutes in this exact JSON format:\n`;
  text += `{\n`;
  text += `  "points_of_agreement": ["..."],\n`;
  text += `  "points_of_disagreement": ["..."],\n`;
  text += `  "unresolved_questions": ["..."],\n`;
  text += `  "recommended_next_action": "...",\n`;
  text += `  "consensus_level": "strong|moderate|split|unresolved",\n`;
  text += `  "raw_minutes_text": "A plain-English summary of the council session."\n`;
  text += `}\n\n`;
  text += `Respond with ONLY the JSON. No markdown fences. No explanation.`;

  return text;
}

/**
 * Parse the minutes response from the minutes agent.
 * Falls back to a default structure if JSON parsing fails.
 *
 * @param {string} response       — raw response from the minutes agent
 * @param {string} generatedBy    — handle of the agent that produced the minutes
 * @param {Array}  attendees      — list of active agent handles
 * @returns {object}              — structured minutes object matching SCHEMA.md
 */
function parseMinutesResponse(response, generatedBy, attendees) {
  const base = {
    generated_by: `@${generatedBy}`,
    attendees: attendees.map((a) => `@${a}`),
  };

  // Try to extract JSON from the response
  let parsed = null;

  // First try direct parse
  try {
    parsed = JSON.parse(response.trim());
  } catch (_) {
    // Try to find JSON within the response (may have extra text around it)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {
        /* fall through to fallback */
      }
    }
  }

  if (parsed) {
    return {
      ...base,
      points_of_agreement: parsed.points_of_agreement || [],
      points_of_disagreement: parsed.points_of_disagreement || [],
      unresolved_questions: parsed.unresolved_questions || [],
      recommended_next_action: parsed.recommended_next_action || "",
      consensus_level: parsed.consensus_level || "unresolved",
      raw_minutes_text: parsed.raw_minutes_text || response.trim(),
    };
  }

  // Fallback — JSON parsing completely failed
  return {
    ...base,
    points_of_agreement: [],
    points_of_disagreement: [],
    unresolved_questions: [],
    recommended_next_action: "",
    consensus_level: "unresolved",
    raw_minutes_text: response.trim(),
  };
}

module.exports = { buildMinutesPrompt, parseMinutesResponse };
