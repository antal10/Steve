const { buildDeliberationPrompt } = require("./deliberation");

const ROUND_PACKET_SCHEMA_VERSION = 1;
const PACKET_TYPES = {
  V1_PAID_DELIBERATION: "v1_paid_deliberation",
};

/**
 * V1 paid compatibility path.
 *
 * This intentionally returns the exact prompt string produced by
 * buildDeliberationPrompt(...). Future packet types may return richer packet
 * metadata, but this path is pinned by byte-equality tests so paid
 * deliberation prompt behavior cannot drift while artifact mirroring evolves.
 */
function buildV1PaidDeliberationPacket({ agentHandle, prompt, otherPosts }) {
  if (!agentHandle) {
    throw new Error("Missing agent handle.");
  }

  if (!Array.isArray(otherPosts)) {
    throw new Error("otherPosts must be an array.");
  }

  return buildDeliberationPrompt(agentHandle, prompt, otherPosts);
}

function buildRoundPacket({ packetType = PACKET_TYPES.V1_PAID_DELIBERATION, ...options }) {
  switch (packetType) {
    case PACKET_TYPES.V1_PAID_DELIBERATION:
      return buildV1PaidDeliberationPacket(options);
    default:
      throw new Error(`Unsupported round packet type: ${packetType}`);
  }
}

module.exports = {
  PACKET_TYPES,
  ROUND_PACKET_SCHEMA_VERSION,
  buildRoundPacket,
  buildV1PaidDeliberationPacket,
};
