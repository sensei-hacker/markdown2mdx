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
import { transform as demoteH1 }                  from './transforms/h1-demote.js';
import { transform as fixHtml }                   from './transforms/html-fix.js';
import { transform as escapeJsx }                 from './transforms/escape-jsx.js';
import { transform as rewriteLinks }              from './transforms/links.js';
import { transform as rewriteImages }             from './transforms/images.js';
import { transform as normalizeHorizontalRules }  from './transforms/horizontal-rules.js';
import { transform as fixReversedLinks }          from './transforms/reversed-links.js';
import { transform as addFrontMatter,
         extractFrontMatter,
         extractTitle }                           from './transforms/front-matter.js';

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

    // Step 1b: Capture H1 title before it is demoted (used by front matter below)
    const h1Title = extractTitle(result);

    // Step 2: Convert admonitions (>[!NOTE], **Note:**, ---\nWarning:\n---, etc.)
    if (this.options.convertAdmonitions) {
      result = convertAdmonitions(result);
    }

    // Step 3: Demote H1 headings to H2 (Docusaurus renders the front-matter
    // title as H1; a # in the body would create a conflicting second H1)
    result = demoteH1(result);

    // Step 5: Fix HTML for JSX compatibility
    if (this.options.fixSelfClosingTags) {
      result = fixHtml(result);
    }

    // Step 6: Escape JSX-problematic characters
    if (this.options.escapeJsxChars) {
      result = escapeJsx(result);
    }

    // Step 7: Normalize underscore separators → horizontal rules
    result = normalizeHorizontalRules(result);

    // Step 8: Rewrite wiki links to relative docs paths
    if (this.options.rewriteLinks) {
      result = rewriteLinks(result, ctx);
    }

    // Step 9: Rewrite GitHub image URLs to local paths
    if (this.options.rewriteImages) {
      result = rewriteImages(result, ctx);
    }

    // Step 10: Strip trailing whitespace (wiki uses "  " for line breaks; manual strips them)
    if (this.options.stripTrailingWhitespace) {
      result = stripTrailingWhitespace(result);
    }

    // Step 11: Fix reversed markdown links: (text)[url] → [text](url)
    result = fixReversedLinks(result);

    // Step 12: Ensure file ends with a single newline
    result = result.trimEnd() + '\n';

    // Step 13: Add front matter
    if (existingFm && this.options.preserveExistingFrontMatter) {
      result = existingFm + '\n\n' + result;
    } else if (this.options.addFrontMatter) {
      result = addFrontMatter(result, {
        minimal: this.options.minimalFrontMatter,
        title: opts.title || h1Title || undefined,
        stem: opts.stem,
        sidebarPosition: this.options.minimalFrontMatter ? undefined : opts.sidebarPosition,
        sidebarLabel: this.options.minimalFrontMatter ? undefined : opts.sidebarLabel,
      });
    }

    return { content: result };
  }
}

export default GfmToMdxConverter;
