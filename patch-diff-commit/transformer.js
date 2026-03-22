/**
 * GFM to MDX Transformer
 *
 * Transforms GFM content to MDX format by delegating to the shared,
 * well-tested transforms in full_file/transforms/.
 *
 * GfmToMdxTransformer is used by the merger for two scenarios:
 *   - transform(content): full content string (code blocks auto-protected)
 *   - transformLines(lines): line-by-line with explicit code-block tracking
 *     (used for diff hunks that may start mid-code-block)
 *
 * MdxToGfmTransformer reverses MDX escaping for comparison/matching purposes.
 */

import { transform as convertAdmonitions } from '../full_file/transforms/admonitions.js';
import { transform as escapeJsx } from '../full_file/transforms/escape-jsx.js';
import { transform as fixHtml, VOID_ELEMENTS } from '../full_file/transforms/html-fix.js';

export { VOID_ELEMENTS };

// =============================================================================
// GfmToMdxTransformer
// =============================================================================

export class GfmToMdxTransformer {
  constructor(options = {}) {
    this.options = {
      convertAdmonitions: true,
      escapeJsxChars: true,
      fixHtml: true,
      ...options
    };
  }

  /**
   * Transform a single prose line.
   * Safe to call on individual lines: inline code is protected,
   * and code-fence multi-line patterns simply won't match.
   */
  transformLine(line) {
    let result = line;
    if (this.options.escapeJsxChars) result = escapeJsx(result);
    if (this.options.fixHtml) result = fixHtml(result);
    return result;
  }

  /**
   * Transform an array of lines, skipping fenced code blocks and indented code.
   * Maintains code-block state so a hunk that starts mid-block is handled correctly.
   *
   * Admonitions are converted first (they require the full block as a string),
   * then per-line transforms are applied with code-block tracking.
   *
   * @param {string[]} lines
   * @param {boolean} [startInCodeBlock=false] - true if the first line is already inside a code block
   * @returns {string[]}
   */
  transformLines(lines, startInCodeBlock = false) {
    // Pass 1: admonitions (multi-line pattern — needs the full block as a string)
    if (this.options.convertAdmonitions) {
      lines = convertAdmonitions(lines.join('\n')).split('\n');
    }

    const result = [];
    let inCodeBlock = startInCodeBlock;
    let codeBlockMarker = null;

    for (const line of lines) {
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockMarker = fenceMatch[1][0];
        } else if (line.startsWith(codeBlockMarker.repeat(3))) {
          inCodeBlock = false;
          codeBlockMarker = null;
        }
        result.push(line);
        continue;
      }

      // Don't transform code block or indented-code content
      if (inCodeBlock || /^    /.test(line)) {
        result.push(line);
        continue;
      }

      result.push(this.transformLine(line));
    }

    return result;
  }

  /**
   * Transform full content string.
   * Delegates directly to the shared transforms, which protect fenced code
   * blocks and inline code via findProtected() internally.
   *
   * @param {string} content
   * @returns {string}
   */
  transform(content) {
    let result = content;
    if (this.options.convertAdmonitions) result = convertAdmonitions(result);
    if (this.options.escapeJsxChars) result = escapeJsx(result);
    if (this.options.fixHtml) result = fixHtml(result);
    return result;
  }
}

// =============================================================================
// MdxToGfmTransformer  (reverse — for fuzzy matching purposes)
// =============================================================================

export class MdxToGfmTransformer {
  /**
   * Strip MDX escapes and class-name rewrites so MDX can be compared to GFM.
   * Not a perfect inverse — only covers what the forward transform changes.
   */
  transform(content) {
    let result = content;
    result = result.replace(/\\</g, '<');
    result = result.replace(/\\>/g, '>');
    result = result.replace(/\\{/g, '{');
    result = result.replace(/\\}/g, '}');
    result = result.replace(/\bclassName=/g, 'class=');
    result = result.replace(/\bhtmlFor=/g, 'for=');
    return result;
  }
}

export default GfmToMdxTransformer;
