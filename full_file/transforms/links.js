/**
 * Transform: Wiki Link Rewriting
 *
 * Rewrites GitHub wiki URLs and [[wiki links]] to relative Docusaurus paths.
 * Also converts root-relative GitHub links (/iNavFlight/...) to full URLs
 * so they don't break when hosted outside github.com.
 *
 * Requires ctx.linkRewriter (a LinkRewriter instance) to be provided.
 * The LinkRewriter is created externally (by cli.js) because it depends on
 * a page mapping built by scanning the docs directory — a one-time setup
 * step shared across all files in a conversion run.
 *
 * Interface: transform(content, ctx?) => string
 * ctx: { linkRewriter? }
 *
 * Also exports: LinkRewriter, buildPageMapping  (used by cli.js)
 */

import path from 'path';
import fs from 'fs';

// =============================================================================
// Transform function
// =============================================================================

/**
 * Rewrite wiki links to relative doc paths.
 *
 * @param {string} content
 * @param {object} ctx
 * @param {LinkRewriter} [ctx.linkRewriter]
 * @returns {string}
 */
export function transform(content, ctx = {}) {
  if (!ctx.linkRewriter) return content;
  return ctx.linkRewriter.rewriteAll(content);
}

// =============================================================================
// Page Mapping Builder
// =============================================================================

/**
 * Build a normalized page name → relative-path-within-docs mapping by scanning
 * an existing Docusaurus docs directory.
 *
 * @param {string} docsDir  Absolute path to the docs/ directory
 * @returns {Map<string, string>}  Normalized name → 'category/PageName.md'
 */
/**
 * Convert a heading's text to its GFM/Docusaurus anchor slug.
 * Matches GitHub's algorithm: lowercase, strip non-(word|space|hyphen), spaces→hyphens.
 * @param {string} text  Raw heading text (without leading #s)
 * @returns {string}
 */
function headingToAnchor(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Extract the set of valid anchor slugs from a markdown file's headings.
 * @param {string} filePath  Absolute path to a .md file
 * @returns {Set<string>}
 */
function extractAnchors(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const anchors = new Set();
    for (const m of content.matchAll(/^ {0,3}#{1,6}\s+(.+)$/gm)) {
      anchors.add(headingToAnchor(m[1].trim()));
    }
    return anchors;
  } catch {
    return new Set();
  }
}

export function buildPageMapping(docsDir) {
  const mapping = new Map();
  // headingMap: relPath → Set<anchor> — attached as a property for anchor validation.
  // Backward-compatible: all existing callers use Map methods (.get/.has/.size) and
  // do not inspect extra properties.
  const headingMap = new Map();

  function scan(dir, relBase) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scan(path.join(dir, entry.name), path.join(relBase, entry.name));
      } else if (entry.name.endsWith('.md') && entry.name !== '_category_.json') {
        const stem = entry.name.slice(0, -3); // strip .md
        const relPath = path.join(relBase, entry.name);

        // Store under multiple normalizations for fuzzy matching
        for (const key of normalizeVariants(stem)) {
          if (!mapping.has(key)) mapping.set(key, relPath);
        }

        // Index headings for anchor validation
        headingMap.set(path.normalize(relPath), extractAnchors(path.join(dir, entry.name)));
      }
    }
  }

  scan(docsDir, '');
  mapping.headingMap = headingMap;
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
// LinkRewriter Class
// =============================================================================

export class LinkRewriter {
  /**
   * @param {Map<string, string>} pageMapping  From buildPageMapping()
   * @param {string} currentFilePath  Relative path of file being converted
   *   within the output docs dir (e.g., 'features/Failsafe.md').
   *   Used to compute relative links. If null, links will use absolute
   *   root-relative paths (/docs/...).
   */
  constructor(pageMapping, currentFilePath = null, validateAnchors = false) {
    this.pageMapping = pageMapping;
    this.headingMap = validateAnchors ? (pageMapping.headingMap || null) : null;
    this.currentFilePath = currentFilePath;
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

  /** Build the href string for a found link. */
  buildHref(found) {
    const normTarget = path.normalize(found.targetPath);

    // Same-file anchor: emit bare #anchor instead of ./File.md#anchor
    if (found.anchor && this.currentFilePath && normTarget === path.normalize(this.currentFilePath)) {
      return `#${found.anchor}`;
    }

    let anchor = found.anchor;
    // Drop anchors that don't exist in the target file's headings (stale wiki links)
    if (anchor && this.headingMap) {
      const anchors = this.headingMap.get(normTarget);
      if (anchors && !anchors.has(anchor)) {
        anchor = null;
      }
    }

    const base = this.toRelative(found.targetPath);
    return anchor ? `${base}#${anchor}` : base;
  }

  /**
   * Rewrite GitHub wiki URLs in markdown link syntax.
   * Handles both absolute and relative GitHub wiki URLs:
   *   [text](https://github.com/iNavFlight/inav/wiki/PageName#anchor)
   *   [text](/iNavFlight/inav/wiki/PageName)
   *   → [text](./relative/path.md#anchor)
   */
  rewriteWikiUrls(content) {
    // Absolute: https://github.com/iNavFlight/inav/wiki/...
    // The URL pattern allows one level of balanced parens (e.g. Lightweight-Telemetry-(LTM))
    // so that the closing ) of the markdown link is not confused with ) inside the URL.
    content = content.replace(
      /\[([^\]]*)\]\(https?:\/\/github\.com\/iNavFlight\/inav\/wiki\/([^()\s]+(?:\([^()]*\)[^()\s]*)*)\)/g,
      (match, text, pageAndAnchor) => {
        const found = this.lookup(pageAndAnchor);
        if (!found) return match;
        return `[${text}](${this.buildHref(found)})`;
      }
    );

    // Relative: /iNavFlight/inav/wiki/... (root-relative GitHub wiki links)
    content = content.replace(
      /\[([^\]]*)\]\(\/iNavFlight\/inav\/wiki\/([^()\s]+(?:\([^()]*\)[^()\s]*)*)\)/g,
      (match, text, pageAndAnchor) => {
        const found = this.lookup(pageAndAnchor);
        if (!found) return match;
        return `[${text}](${this.buildHref(found)})`;
      }
    );

    return content;
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
   * Fix root-relative GitHub links that the wiki uses because it was hosted on
   * github.com (where "/" is the domain root).  In our Docusaurus site, those
   * paths would resolve to our own domain, producing broken links.
   *
   * Converts:
   *   [text](/iNavFlight/inav/releases/...)  →  [text](https://github.com/iNavFlight/inav/releases/...)
   *   [text](/iNavFlight/inav/blob/...)       →  [text](https://github.com/iNavFlight/inav/blob/...)
   *
   * Does NOT touch /iNavFlight/inav/wiki/... — those are handled by rewriteWikiUrls.
   */
  fixRootRelativeGitHubLinks(content) {
    return content.replace(
      /\[([^\]]*)\]\((\/(iNavFlight|inav-configurator)\/.+?)\)/g,
      (match, text, linkPath) => `[${text}](https://github.com${linkPath})`
    );
  }

  /**
   * Rewrite plain relative .md links and bare page-name links.
   *
   * Handles cases the wiki uses that survive into converted output:
   *   [text](./GPS-and-Compass-setup.md)   — relative same-dir
   *   [text](../features/Failsafe.md)       — relative cross-dir
   *   [text](MSP-V2)                        — bare page name, no .md
   *
   * In all cases the stem is looked up in the page mapping (normalized),
   * so filenames whose wiki slug differs from their Docusaurus name
   * (e.g. commas or colons stripped in links) are resolved correctly.
   */
  rewriteRelativeMdLinks(content) {
    return content.replace(
      /\[([^\]]*)\]\(([^)#\s]+)(#[^)\s]*)?\)/g,
      (match, text, url, anchor = '') => {
        // Skip external URLs and absolute paths (already handled elsewhere)
        if (
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url.startsWith('/') ||
          url.startsWith('mailto:')
        ) return match;

        // Extract the basename stem (strips directory prefix and .md extension)
        const basename = path.basename(url);
        const stem = basename.endsWith('.md') ? basename.slice(0, -3) : basename;

        if (!stem || stem === '.' || stem === '..') return match;

        const found = this.lookup(stem + (anchor ? anchor : ''));
        if (!found) return match;

        return `[${text}](${this.buildHref(found)})`;
      }
    );
  }

  /** Apply all link rewrites. */
  rewriteAll(content) {
    content = this.rewriteWikiUrls(content);
    content = this.rewriteDoubleLinks(content);
    content = this.fixRootRelativeGitHubLinks(content);
    content = this.rewriteRelativeMdLinks(content);
    return content;
  }
}

export default transform;
