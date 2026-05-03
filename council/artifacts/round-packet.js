/**
 * round-packet.js - builds the frozen broadcast packet for a debate round.
 *
 * Contract (see docs/debate_artifacts.md):
 *   - Round N's packet is composed only after every Round N-1 post is
 *     written and the round_frozen event is emitted.
 *   - Every agent in Round N receives the exact same bytes; the same
 *     content_hash appears in the reception matrix for every recipient.
 *   - Round 1 for paid V1 must be byte-equivalent to today's
 *     buildDeliberationPrompt output when fed the same inputs. This is the
 *     regression guard before we change pipeline.js.
 *   - Returns { text, content_hash } and writes packets/round_<N>_packet.md.
 *
 * Not implemented yet. The pipeline does not call this module.
 */

function buildRoundPacket(_runDir, _round, _inputs) {
  throw new Error("round-packet.buildRoundPacket not implemented yet");
}

module.exports = { buildRoundPacket };
