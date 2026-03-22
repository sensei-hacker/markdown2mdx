/**
 * GFM to MDX Converter
 *
 * Orchestrates individual transformation modules to convert GitHub Flavored
 * Markdown (wiki format) to Docusaurus-compatible MDX.
 *
 * Each transformation lives in its own file under transforms/ with a
 * consistent interface:  transform(content, ctx?) => string
 */

import { transform as stripTrailingWhitespace } from './transforms/trailing-whitespace.js';
import { transform as convertAdmonitions }        from './transforms/admonitions.js';
import { transform as fixHtml }                   from './transforms/html-fix.js';
import { transform as escapeJsx }                 from './transforms/escape-jsx.js';
import { transform as rewriteLinks }              from './transforms/links.js';
import { transform as rewriteImages }             from './transforms/images.js';
import { transform as normalizeHorizontalRules }  from './transforms/horizontal-rules.js';
import { transform as fixReversedLinks }          from './transforms/reversed-links.js';
import { transform as addFrontMatter,
         extractFrontMatter }                     from './transforms/front-matter.js';

export { VOID_ELEMENTS } from './transforms/html-fix.js';

// =============================================================================
// Main Converter
// =============================================================================

export class GfmToMdxConverter {
  /**
   * @param {object} options
   * @param {boolean} [options.addFrontMatter=true]
   * @param {boolean} [options.minimalFrontMatter=false]  Only emit title:
   * @param {boolean} [options.convertAdmonitions=true]
   * @param {boolean} [options.rewriteLinks=false]
   * @param {boolean} [options.rewriteImages=false]
   * @param {boolean} [options.escapeJsxChars=true]
   * @param {boolean} [options.fixSelfClosingTags=true]
   * @param {boolean} [options.stripTrailingWhitespace=true]
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options = {
      addFrontMatter: true,
      minimalFrontMatter: false,
      convertAdmonitions: true,
      rewriteLinks: false,
      rewriteImages: false,
      escapeJsxChars: true,
      fixSelfClosingTags: true,
      stripTrailingWhitespace: true,
      preserveExistingFrontMatter: true,
      verbose: false,
      ...options,
    };

    this.linkRewriter = null;
    this.imageRewriter = null;
  }

  /** Set the LinkRewriter instance (created externally by cli.js). */
  setLinkRewriter(rewriter) {
    this.linkRewriter = rewriter;
  }

  /** Set the ImageRewriter instance. */
  setImageRewriter(rewriter) {
    this.imageRewriter = rewriter;
  }

  /**
   * Convert markdown content to MDX.
   *
   * @param {string} content
   * @param {object} opts
   * @param {number} [opts.sidebarPosition]
   * @param {string} [opts.sidebarLabel]   Filename stem (capitalized)
   * @param {string} [opts.stem]           Raw filename stem
   * @returns {{ content: string }}
   */
  convert(content, opts = {}) {
    // Build transform context (stateful transforms receive external objects)
    const ctx = {
      linkRewriter: this.linkRewriter,
      imageRewriter: this.imageRewriter,
    };

    // Step 1: Extract existing front matter (preserve if present)
    const { frontMatter: existingFm, body } = extractFrontMatter(content);
    let result = body;

    // Step 2: Convert admonitions (>[!NOTE], **Note:**, ---\nWarning:\n---, etc.)
    if (this.options.convertAdmonitions) {
      result = convertAdmonitions(result);
    }

    // Step 3: Fix HTML for JSX compatibility
    if (this.options.fixSelfClosingTags) {
      result = fixHtml(result);
    }

    // Step 4: Escape JSX-problematic characters
    if (this.options.escapeJsxChars) {
      result = escapeJsx(result);
    }

    // Step 5: Normalize underscore separators → horizontal rules
    result = normalizeHorizontalRules(result);

    // Step 6: Rewrite wiki links to relative docs paths
    if (this.options.rewriteLinks) {
      result = rewriteLinks(result, ctx);
    }

    // Step 7: Rewrite GitHub image URLs to local paths
    if (this.options.rewriteImages) {
      result = rewriteImages(result, ctx);
    }

    // Step 8: Strip trailing whitespace (wiki uses "  " for line breaks; manual strips them)
    if (this.options.stripTrailingWhitespace) {
      result = stripTrailingWhitespace(result);
    }

    // Step 9: Fix reversed markdown links: (text)[url] → [text](url)
    result = fixReversedLinks(result);

    // Step 10: Ensure file ends with a single newline
    result = result.trimEnd() + '\n';

    // Step 11: Add front matter
    if (existingFm && this.options.preserveExistingFrontMatter) {
      result = existingFm + '\n\n' + result;
    } else if (this.options.addFrontMatter) {
      result = addFrontMatter(result, {
        minimal: this.options.minimalFrontMatter,
        stem: opts.stem,
        sidebarPosition: this.options.minimalFrontMatter ? undefined : opts.sidebarPosition,
        sidebarLabel: this.options.minimalFrontMatter ? undefined : opts.sidebarLabel,
      });
    }

    return { content: result };
  }
}

export default GfmToMdxConverter;
