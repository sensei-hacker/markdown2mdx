/**
 * Transform: Link Normalization
 *
 * Fixes two systematic issues that arise when converting GitHub wiki links
 * to Docusaurus relative paths:
 *
 * 1. Anchor case: Docusaurus (and GitHub) generate heading anchors in all
 *    lowercase. Wiki source links may preserve the original heading
 *    capitalization (e.g. #Nav-poshold---Position-hold, #Message-Types).
 *    This transform lowercases all anchor fragments so they match the
 *    generated IDs.
 *
 * 2. Consecutive hyphens in filenames: GitHub wiki page slugs sometimes
 *    contain double hyphens (e.g. GPS--and-Compass-setup.md) that become
 *    single hyphens in the Docusaurus file names. Normalizes --+ → - in
 *    the path part of relative links.
 *
 * Both fixes apply only to relative links (not http/https URLs).
 * Code blocks and inline code are not modified.
 *
 * Interface: transform(content, ctx?) => string
 */

/**
 * Find fenced code blocks and inline code spans.
 * Returns sorted non-overlapping [{start, end}] ranges to skip.
 *
 * @param {string} content
 * @returns {Array<{start: number, end: number}>}
 */
function findProtected(content) {
  const regions = [];
  let m;

  const fenceRe = /^(`{3,}|~{3,})([^\n]*)\n[\s\S]*?\n\1/gm;
  while ((m = fenceRe.exec(content)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  const inlineRe = /`[^`\n]+`/g;
  while ((m = inlineRe.exec(content)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  return regions.sort((a, b) => a.start - b.start);
}

/**
 * Normalize a single link URL:
 *  - Lowercase the anchor fragment
 *  - Collapse consecutive hyphens in the path (for relative links only)
 *
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  // Leave external URLs alone
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    return url;
  }

  const hashIdx = url.indexOf('#');
  let pathPart = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  let anchorPart = hashIdx >= 0 ? url.slice(hashIdx) : '';

  // Collapse consecutive hyphens in path component
  pathPart = pathPart.replace(/-{2,}/g, '-');

  // Lowercase anchor
  anchorPart = anchorPart.toLowerCase();

  return pathPart + anchorPart;
}

/**
 * Normalize anchors and hyphens in markdown link URLs,
 * skipping code blocks and inline code.
 *
 * @param {string} content
 * @returns {string}
 */
export function transform(content) {
  const protected_ = findProtected(content);

  // Replace [text](url) patterns, skipping protected regions
  return content.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, text, url, offset) => {
    // Check if this match falls inside a protected region
    const end = offset + match.length;
    for (const region of protected_) {
      if (region.start > end) break;
      if (offset >= region.start && end <= region.end) return match;
    }

    const newUrl = normalizeUrl(url);
    if (newUrl === url) return match;
    return `[${text}](${newUrl})`;
  });
}

export default transform;
