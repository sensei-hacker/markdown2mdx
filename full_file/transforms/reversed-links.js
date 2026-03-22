/**
 * Transform: Reversed Link Fix
 *
 * Wiki content occasionally contains markdown links with reversed syntax:
 *   (text)[url]  →  [text](url)
 *
 * This is a common wiki-editing mistake where the author typed parens
 * first instead of brackets.
 *
 * Interface: transform(content, ctx?) => string
 */

/**
 * Fix reversed markdown link syntax.
 *
 * @param {string} content
 * @returns {string}
 */
export function transform(content) {
  return content.replace(/\(([^)]+)\)\[([^\]]+)\]/g, '[$1]($2)');
}

export default transform;
