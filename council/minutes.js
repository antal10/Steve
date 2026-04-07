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

function normalizeText(value) {
  return String(value || "").trim();
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function extractJsonObject(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : null;
}

function findNextNonWhitespace(text, startIndex) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) {
      return { char: text[index], index };
    }
  }

  return { char: "", index: -1 };
}

function isClosingJsonQuote(text, quoteIndex) {
  const next = findNextNonWhitespace(text, quoteIndex + 1);
  if (!next.char || next.char === ":" || next.char === "}" || next.char === "]") {
    return true;
  }

  if (next.char !== ",") {
    return false;
  }

  const afterComma = findNextNonWhitespace(text, next.index + 1);
  return !afterComma.char || afterComma.char === '"' || afterComma.char === "}" || afterComma.char === "]";
}

function repairQuotedJsonStrings(text) {
  let repaired = "";
  let inString = false;
  let escaping = false;
  let changed = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (!inString) {
      repaired += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (escaping) {
      repaired += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      repaired += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      if (isClosingJsonQuote(text, index)) {
        repaired += char;
        inString = false;
      } else {
        repaired += '\\"';
        changed = true;
      }
      continue;
    }

    repaired += char;
  }

  return changed ? repaired : text;
}

function parseInlineItems(value) {
  return String(value || "")
    .split(/\s*[;•]\s*/)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function parseSectionFallback(text) {
  const sections = {
    points_of_agreement: [],
    points_of_disagreement: [],
    unresolved_questions: [],
    recommended_next_action: "",
    consensus_level: "",
    raw_minutes_text: "",
  };
  const arrayKeys = new Set([
    "points_of_agreement",
    "points_of_disagreement",
    "unresolved_questions",
  ]);
  const definitions = [
    {
      key: "points_of_agreement",
      pattern: /^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:points?\s+of\s+agreement|agreements?)\s*:?\s*(.*)$/i,
    },
    {
      key: "points_of_disagreement",
      pattern: /^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:points?\s+of\s+disagreement|disagreements?)\s*:?\s*(.*)$/i,
    },
    {
      key: "unresolved_questions",
      pattern: /^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:unresolved\s+questions?|open\s+questions?)\s*:?\s*(.*)$/i,
    },
    {
      key: "recommended_next_action",
      pattern: /^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:recommended\s+next\s+action|next\s+action)\s*:?\s*(.*)$/i,
    },
    {
      key: "consensus_level",
      pattern: /^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:consensus(?:\s+level)?)\s*:?\s*(.*)$/i,
    },
    {
      key: "raw_minutes_text",
      pattern: /^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:raw\s+minutes\s+text|summary)\s*:?\s*(.*)$/i,
    },
  ];

  let currentKey = null;
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let matchedDefinition = null;
    let remainder = "";
    for (const definition of definitions) {
      const match = trimmed.match(definition.pattern);
      if (match) {
        matchedDefinition = definition;
        remainder = normalizeText(match[1]);
        break;
      }
    }

    if (matchedDefinition) {
      currentKey = matchedDefinition.key;
      if (arrayKeys.has(currentKey)) {
        sections[currentKey].push(...parseInlineItems(remainder));
      } else if (remainder) {
        sections[currentKey] = sections[currentKey]
          ? `${sections[currentKey]} ${remainder}`.trim()
          : remainder;
      }
      continue;
    }

    if (!currentKey) {
      continue;
    }

    if (arrayKeys.has(currentKey)) {
      const cleanLine = trimmed.replace(/^[-*]\s*/, "").replace(/^\d+[\.\)]\s*/, "").trim();
      if (!cleanLine) {
        continue;
      }

      if (/^[-*]\s|^\d+[\.\)]\s/.test(trimmed) || sections[currentKey].length === 0) {
        sections[currentKey].push(cleanLine);
      } else {
        const lastIndex = sections[currentKey].length - 1;
        sections[currentKey][lastIndex] = `${sections[currentKey][lastIndex]} ${cleanLine}`.trim();
      }
    } else {
      sections[currentKey] = sections[currentKey]
        ? `${sections[currentKey]} ${trimmed}`.trim()
        : trimmed;
    }
  }

  const hasStructuredContent = definitions.some((definition) => {
    const value = sections[definition.key];
    return Array.isArray(value) ? value.length > 0 : Boolean(normalizeText(value));
  });

  return hasStructuredContent ? sections : null;
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
  text += "Your job is to synthesize the full thread into meeting minutes.\n";
  text += "You are not replying as a debate participant, even if you authored some of the messages below.\n";
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
  text += "The first character of your reply must be { and the last character must be }.\n";
  text += "Use the entire council thread, not just your own earlier messages.\n";
  text += "Do not continue the debate. Do not write any 'To @agent' headings. Do not add commentary before or after the JSON.\n";
  text += "Every array must contain concrete items pulled from the thread when available.\n";
  text += "If the council reached no agreement or no disagreement, return an empty array for that field.\n";
  text += "raw_minutes_text must be a concise plain-English synthesis of the session, not a transcript.\n";
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
  let parseStatus = "raw_fallback";
  const parseCandidates = [
    { text: cleanedResponse, status: "json" },
    { text: extractJsonObject(cleanedResponse), status: "json_extracted" },
  ];

  for (const candidate of parseCandidates) {
    if (!candidate.text) {
      continue;
    }

    parsed = tryParseJson(candidate.text);
    if (parsed) {
      parseStatus = candidate.status;
      break;
    }

    const repairedCandidate = repairQuotedJsonStrings(candidate.text);
    if (repairedCandidate === candidate.text) {
      continue;
    }

    parsed = tryParseJson(repairedCandidate);
    if (parsed) {
      parseStatus = `${candidate.status}_repaired`;
      break;
    }
  }

  if (!parsed) {
    parsed = parseSectionFallback(cleanedResponse);
    if (parsed) {
      parseStatus = "section_fallback";
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
      recommended_next_action: normalizeText(parsed.recommended_next_action),
      consensus_level: consensusLevel,
      raw_minutes_text: normalizeText(parsed.raw_minutes_text || cleanedResponse),
      raw_response_text: cleanedResponse,
      parse_status: parseStatus,
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
    raw_response_text: cleanedResponse,
    parse_status: parseStatus,
  };
}

module.exports = { buildMinutesPrompt, parseMinutesResponse };
