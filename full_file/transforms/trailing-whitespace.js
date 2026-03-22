/**
 * Transform: Strip trailing whitespace
 *
 * Wiki markdown often uses trailing spaces ("  ") for line breaks.
 * The manually-converted docs do not use them, so we strip all
 * trailing whitespace from non-code lines.
 *
 * Code fences (``` or ~~~) are left fully intact — trailing whitespace
 * inside a code block is intentional and must be preserved.
 *
 * Interface: transform(content, ctx?) => string
 */

/**
 * Strip trailing whitespace from every non-code line.
 *
 * @param {string} content
 * @returns {string}
 */
export function transform(content) {
  const lines = content.split('\n');
  let inFence = false;

  return lines.map(line => {
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(/[ \t]+$/, '');
  }).join('\n');
}

export default transform;
