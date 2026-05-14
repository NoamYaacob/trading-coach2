const DISTRESS_WORD_LIMIT = 60;

/** Remove leading/trailing whitespace and collapse internal blank lines. */
function trimReply(reply: string): string {
  return reply
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** Prevent doubled sentence-ending punctuation (e.g. "...", "!."). */
function fixPunctuation(reply: string): string {
  return reply
    .replace(/([.!?])\s*[.]/g, "$1")
    .replace(/([.!?])\s*([!?])/g, "$2");
}

/** Cap distress replies to DISTRESS_WORD_LIMIT words, trimming at sentence boundary. */
function capDistressLength(reply: string): string {
  const words = reply.split(/\s+/);
  if (words.length <= DISTRESS_WORD_LIMIT) return reply;

  // Try to cut at a sentence boundary within the limit
  const truncated = words.slice(0, DISTRESS_WORD_LIMIT).join(" ");
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?"),
  );

  if (lastSentenceEnd > truncated.length * 0.5) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }

  // No good boundary found — truncate at word limit
  return truncated.trim();
}

export function postprocess(reply: string, mode: string): string {
  let result = trimReply(reply);
  result = fixPunctuation(result);
  if (mode === "distress") {
    result = capDistressLength(result);
  }
  return result;
}
