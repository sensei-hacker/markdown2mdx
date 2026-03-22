/**
 * Transform: HTML Fixes for MDX Compatibility
 *
 * Fixes common HTML issues in wiki markdown that would break MDX parsing:
 *   - Void elements (<br>, <img>, etc.) need self-closing slash
 *   - class= → className=
 *   - <body> inside <table> → <tbody>
 *   - Unclosed <img> before closing tag
 *   - <td> leading newline (causes MDX block parsing issues)
 *   - Missing </tr> before new <tr>
 *
 * Interface: transform(content, ctx?) => string
 */

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

/**
 * Fix HTML in markdown content for MDX compatibility.
 *
 * @param {string} content
 * @returns {string}
 */
export function transform(content) {
  // Fix unclosed <img> before closing tag (MUST run before void element fixer)
  content = content.replace(/<img\b([^>]*?)\s*(?=<\/)/gi, (match, attrs) => {
    return `<img${attrs} />`;
  });

  // Fix void elements: add self-closing slash
  for (const tag of VOID_ELEMENTS) {
    const pattern = new RegExp(`<(${tag})\\b([^>]*?)(?<!/)>`, 'gi');
    content = content.replace(pattern, (_, name, attrs) => {
      return `<${name}${fixAttributes(attrs)} />`;
    });
  }

  // Fix class → className in all tags
  content = content.replace(/<(\w+)([^>]*)\bclass=([^>]*)>/g, (match, tag, before, after) => {
    return `<${tag}${before}className=${after}>`;
  });

  // Fix <body> used as <tbody> inside tables
  content = content.replace(/(<table\b[^>]*>)([\s\S]*?)(<\/table>)/gi, (match, open, inner, close) => {
    return open + inner.replace(/<body>/gi, '<tbody>') + close;
  });

  // Fix <td> with leading newline (causes MDX block parsing)
  content = content.replace(/(<td[^>]*>)\n[ \t]*/g, '$1');

  // Fix missing </tr> before new <tr>
  content = content.replace(/(<\/td>[ \t]*)\n([ \t]*<tr\b)/g, '$1\n</tr>\n$2');

  return content;
}

function fixAttributes(attrs) {
  if (!attrs?.trim()) return '';
  return attrs
    .replace(/\bclass=/g, 'className=')
    .replace(/\bfor=/g, 'htmlFor=')
    .replace(/(\w+)=(\w+)(?=\s|$)/g, '$1="$2"');
}

export default transform;
