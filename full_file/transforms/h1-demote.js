/**
 * Transform: H1 Heading Demotion
 *
 * Docusaurus renders the `title:` front matter field as an H1 at the top of
 * every page.  A `# Heading` in the body content therefore produces a second
 * H1, which breaks the document outline and changes the rendered page title.
 *
 * This transform promotes all H1 headings (`# Foo`) in the body to H2
 * (`## Foo`) so the front-matter title remains the only H1 on the page.
 *
 * Code blocks (fenced and inline) are never modified.
 *
 * Interface: transform(content, ctx?) => string
 */

/**
 * Demote all H1 headings outside of code blocks to H2.
 *
 * @param {string} content
 * @returns {string}
 */
export function transform(content) {
  const lines = content.split('\n');
  const result = [];
  let inFence = false;
  let fenceMarker = null;

  for (const line of lines) {
    if (!inFence) {
      const fence = line.match(/^(`{3,}|~{3,})/);
      if (fence) {
        inFence = true;
        fenceMarker = fence[1][0];
        result.push(line);
        continue;
      }
      // Demote H1: line starts with exactly one '#' followed by space or end
      if (/^# /.test(line) || line === '#') {
        result.push('#' + line);
      } else {
        result.push(line);
      }
    } else {
      // Inside fence: look for closing marker of same type
      if (fenceMarker && line.startsWith(fenceMarker.repeat(3))) {
        inFence = false;
        fenceMarker = null;
      }
      result.push(line);
    }
  }

  return result.join('\n');
}

export default transform;
