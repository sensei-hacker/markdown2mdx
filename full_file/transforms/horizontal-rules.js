/**
 * Transform: Horizontal Rule Normalization
 *
 * Wiki markdown sometimes uses four or more underscores (____) as section
 * dividers.  Standard markdown and Docusaurus use three dashes (---).
 *
 * Interface: transform(content, ctx?) => string
 */

/**
 * Convert underscore-style horizontal rules to standard dash rules.
 *
 * @param {string} content
 * @returns {string}
 */
export function transform(content) {
  return content.replace(/^_{4,}\s*$/gm, '---');
}

export default transform;
