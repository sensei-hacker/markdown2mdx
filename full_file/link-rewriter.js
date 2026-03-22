/**
 * Link Rewriter for GFM to MDX Converter
 *
 * Rewrites GitHub wiki URLs and [[wiki links]] to relative Docusaurus paths.
 * Requires a page mapping (wiki page name → docs relative path) built from
 * the existing docs directory structure.
 */

import path from 'path';
import fs from 'fs';

// =============================================================================
// Mapping Builder
// =============================================================================

/**
 * Build a normalized page name → relative-path-within-docs mapping by scanning
 * an existing Docusaurus docs directory.
 *
 * @param {string} docsDir  Absolute path to the docs/ directory
 * @returns {Map<string, string>}  Normalized name → 'category/PageName.md'
 */
export function buildPageMapping(docsDir) {
  const mapping = new Map();

  function scan(dir, relBase) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scan(path.join(dir, entry.name), path.join(relBase, entry.name));
      } else if (entry.name.endsWith('.md') && entry.name !== '_category_.json') {
        const stem = entry.name.slice(0, -3); // strip .md
        const relPath = path.join(relBase, entry.name);

        // Store under multiple normalizations for fuzzy matching
        const variants = normalizeVariants(stem);
        for (const key of variants) {
          if (!mapping.has(key)) mapping.set(key, relPath);
        }
      }
    }
  }

  scan(docsDir, '');
  return mapping;
}

/**
 * Generate normalization variants for a page name to handle:
 *  - case differences
 *  - multiple consecutive dashes (e.g., GPS--and → GPS-and)
 *  - URL encoding (e.g., %E2%80%90 = ‐)
 *  - colon replacements
 */
function normalizeVariants(name) {
  try { name = decodeURIComponent(name); } catch { /* keep as-is */ }
  const lower = name.toLowerCase();
  const singleDash = lower.replace(/-{2,}/g, '-');
  // Full normalization: handle colons, commas, parens, consecutive dashes, trailing dash
  const full = lower
    .replace(/[:(,]/g, '-')
    .replace(/[)]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/-$/, '');
  return [...new Set([lower, singleDash, full])];
}

// =============================================================================
// Link Rewriter
// =============================================================================

export class LinkRewriter {
  /**
   * @param {Map<string, string>} pageMapping  From buildPageMapping()
   * @param {string} currentFilePath  Relative path of file being converted
   *   within the output docs dir (e.g., 'features/Failsafe.md').
   *   Used to compute relative links. If null, links will use absolute
   *   root-relative paths (/docs/...).
   */
  constructor(pageMapping, currentFilePath = null) {
    this.pageMapping = pageMapping;
    this.currentDir = currentFilePath ? path.dirname(currentFilePath) : null;
  }

  /**
   * Normalize a wiki page name for lookup.
   * Handles colons, commas, parentheses, URL encoding, and consecutive dashes.
   */
  normalize(name) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep as-is if decoding fails
    }
    return name
      .toLowerCase()
      .replace(/[:(,]/g, '-')  // colons, commas, open-parens → dashes
      .replace(/[)]/g, '')     // close-parens → remove
      .replace(/-{2,}/g, '-') // collapse consecutive dashes
      .replace(/-$/, '');     // remove trailing dash
  }

  /**
   * Look up a wiki page name in the mapping.
   * Returns { targetPath, anchor } or null if not found.
   *
   * @param {string} wikiName  Page name from wiki URL or [[link]]
   */
  lookup(wikiName) {
    // Split off anchor
    const hashIdx = wikiName.indexOf('#');
    const anchor = hashIdx >= 0 ? wikiName.slice(hashIdx + 1) : null;
    const namePart = hashIdx >= 0 ? wikiName.slice(0, hashIdx) : wikiName;

    const key = this.normalize(namePart);
    const targetPath = this.pageMapping.get(key);
    if (targetPath) return { targetPath, anchor };

    // Try stripping trailing special chars
    const trimKey = key.replace(/[-_.]+$/, '');
    const targetPath2 = this.pageMapping.get(trimKey);
    if (targetPath2) return { targetPath: targetPath2, anchor };

    return null;
  }

  /**
   * Compute the relative path from this file's directory to the target docs path.
   * If currentDir is null, returns an absolute /docs/ path.
   */
  toRelative(targetPath) {
    if (this.currentDir === null) {
      return '/docs/' + targetPath.replace(/\\/g, '/');
    }
    let rel = path.relative(this.currentDir, targetPath).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
  }

  /**
   * Build the href string for a found link.
   */
  buildHref(found) {
    const base = this.toRelative(found.targetPath);
    return found.anchor ? `${base}#${found.anchor}` : base;
  }

  /**
   * Rewrite GitHub wiki URLs in markdown link syntax.
   * [text](https://github.com/iNavFlight/inav/wiki/PageName#anchor)
   *   → [text](./relative/path.md#anchor)
   */
  rewriteWikiUrls(content) {
    return content.replace(
      /\[([^\]]*)\]\(https?:\/\/github\.com\/iNavFlight\/inav\/wiki\/([^)\s]+)\)/g,
      (match, text, pageAndAnchor) => {
        const found = this.lookup(pageAndAnchor);
        if (!found) return match; // leave unknown links as-is
        return `[${text}](${this.buildHref(found)})`;
      }
    );
  }

  /**
   * Rewrite [[wiki links]] to standard markdown links.
   * [[PageName]] → [PageName](./path.md)
   * [[display text|PageName]] → [display text](./path.md)
   */
  rewriteDoubleLinks(content) {
    return content.replace(
      /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
      (match, textOrPage, page) => {
        const pageName = (page || textOrPage).trim();
        const text = page ? textOrPage.trim() : textOrPage.trim();
        const found = this.lookup(pageName);
        if (!found) return match; // leave unknown links as-is
        return `[${text}](${this.buildHref(found)})`;
      }
    );
  }

  /**
   * Apply all link rewrites.
   */
  rewriteAll(content) {
    content = this.rewriteWikiUrls(content);
    content = this.rewriteDoubleLinks(content);
    return content;
  }
}

export default LinkRewriter;
