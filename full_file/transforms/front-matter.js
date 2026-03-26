/**
 * Transform: Front Matter Generation
 *
 * Generates YAML front matter for Docusaurus pages.
 * In minimal mode (--minimal-front-matter), only emits `title:`.
 *
 * Title resolution order:
 *   1. Explicit title passed in ctx
 *   2. First H1 heading found in content
 *   3. Filename stem (from ctx.stem), capitalized
 *
 * Interface: transform(content, ctx?) => string
 * ctx: { title?, stem?, slug?, sidebarPosition?, sidebarLabel?, minimal? }
 */

/**
 * Extract the first H1 heading from content.
 * @param {string} content
 * @returns {string|null}
 */
export function extractTitle(content) {
  const m = content.match(/^# (.+)$/m);
  return m ? m[1].trim() : null;
}

// Articles, conjunctions, and prepositions that stay lowercase in title case
// (unless they are the first word).
const LOWERCASE_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up',
  'from', 'into', 'like', 'near', 'over', 'past',
  'per', 'than', 'via', 'with',
]);

/**
 * Convert a filename stem to a human-readable title.
 * Replaces hyphens/underscores with spaces and capitalizes each word,
 * lowercasing articles, conjunctions, and short prepositions (except the first word).
 * Preserves known mixed-case tokens (iNav, INAV, GPS) by matching them
 * in the original stem before splitting.
 *
 * e.g. "Sensor-calibration"         → "Sensor Calibration"
 * e.g. "PID-Attenuation-and-scaling" → "PID Attenuation and Scaling"
 * e.g. "Getting-started-with-iNav"   → "Getting Started with iNav"
 * e.g. "iNav-CLI-variables"          → "iNav CLI Variables"
 *
 * @param {string} stem
 * @returns {string}
 */
export function stemToTitle(stem) {
  // Known tokens to preserve exactly (case-sensitive match after split)
  const PRESERVE = { inav: 'iNav', inavflight: 'iNavFlight' };

  const words = stem.replace(/[-_]/g, ' ').split(' ');

  return words
    .map((word, idx) => {
      const lower = word.toLowerCase();
      // Preserve known tokens exactly (e.g. iNav, iNavFlight)
      if (PRESERVE[lower]) return PRESERVE[lower];
      // Preserve short all-uppercase words as acronyms (e.g. MSP, GPS, LTM, OSD, RTH)
      // 2-5 chars: almost certainly an acronym. Longer all-caps words are likely sentences-case titles.
      if (word.length >= 2 && word.length <= 5 && word === word.toUpperCase() && /^[A-Z]/.test(word)) return word;
      // First word is always capitalized
      if (idx === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      // Lowercase articles/conjunctions/prepositions
      if (LOWERCASE_WORDS.has(lower)) return lower;
      // Default: capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Serialize a front matter object to YAML string (simple subset).
 * @param {object} fm
 * @returns {string}
 */
function toYaml(fm) {
  const keys = Object.keys(fm).filter(k => fm[k] !== undefined && fm[k] !== null);
  if (keys.length === 0) return '';
  const lines = ['---'];
  for (const key of keys) {
    const val = fm[key];
    if (typeof val === 'string' && /[:#\[\]{}|>&*!?,\n"]/.test(val)) {
      lines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Generate and prepend front matter to content.
 *
 * Title resolution (minimal mode, matching manual conversion convention):
 *   1. Explicit title from ctx
 *   2. Filename stem converted to human-readable (e.g. "Sensor-calibration" → "Sensor Calibration")
 *   3. First H1 in content (fallback)
 *
 * The manual conversion consistently uses the filename stem for the title,
 * not the H1 heading from the wiki source.
 *
 * @param {string} content  - Page body (without existing front matter)
 * @param {object} ctx
 * @param {string}  [ctx.title]           - Explicit title override
 * @param {string}  [ctx.stem]            - Filename stem for title (primary source)
 * @param {string}  [ctx.slug]            - URL slug
 * @param {number}  [ctx.sidebarPosition] - sidebar_position value
 * @param {string}  [ctx.sidebarLabel]    - sidebar_label value
 * @param {boolean} [ctx.minimal=true]    - If true, only emit title
 * @returns {string}
 */
export function transform(content, ctx = {}) {
  const minimal = ctx.minimal !== false; // default true

  // Manual convention: title from stem first, then H1, then null
  const title = ctx.title
    || (ctx.stem ? stemToTitle(ctx.stem) : null)
    || extractTitle(content);

  if (minimal) {
    const fm = toYaml({ title });
    return fm ? `${fm}\n\n${content}` : content;
  }

  const fm = toYaml({
    title,
    slug: ctx.slug || undefined,
    sidebar_position: ctx.sidebarPosition || undefined,
    sidebar_label: ctx.sidebarLabel || undefined,
  });
  return fm ? `${fm}\n\n${content}` : content;
}

/**
 * Extract and strip existing YAML front matter from content.
 * Returns { frontMatter, body }.
 * @param {string} content
 * @returns {{ frontMatter: string|null, body: string }}
 */
export function extractFrontMatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    return { frontMatter: m[0].trim(), body: content.slice(m[0].length).trim() };
  }
  return { frontMatter: null, body: content };
}

/**
 * Normalize the title field in an existing front matter block.
 * If the title is all-uppercase (e.g. "TROUBLESHOOTING"), converts it to
 * title case using stemToTitle. Mixed-case and short acronym titles are
 * left unchanged.
 *
 * @param {string} fmBlock  Raw front matter block including --- delimiters
 * @returns {string}
 */
export function normalizeFrontMatterTitle(fmBlock) {
  return fmBlock.replace(
    /^(title:\s*)(.+)$/m,
    (match, prefix, rawTitle) => {
      const title = rawTitle.trim().replace(/^["']|["']$/g, ''); // strip quotes
      // Only normalize if every alphabetic character is uppercase
      // and the title is long enough not to be an acronym
      if (title.length > 4 && title === title.toUpperCase() && /[A-Z]{2,}/.test(title) && !/\d/.test(title)) {
        const normalized = stemToTitle(title.toLowerCase().replace(/\s+/g, '-'));
        return `${prefix}${normalized}`;
      }
      return match;
    }
  );
}

export default transform;
