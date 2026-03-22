/**
 * Text Normalizer for GFM↔MDX Comparison
 *
 * GFM and MDX represent the same content differently:
 *   GFM:  Air<2g      MDX: Air\<2g  or  Air&lt;2g
 *   GFM:  {0-255}     MDX: \{0-255\}
 *
 * This module strips those differences so lines can be compared
 * regardless of which escaping style the MDX file uses.
 */

// =============================================================================
// Constants
// =============================================================================

export const HTML_ENTITIES = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&#123;': '{',
  '&#125;': '}',
  '&#x3C;': '<',
  '&#x3E;': '>',
  '&#x7B;': '{',
  '&#x7D;': '}',
};

export const MDX_ESCAPES = {
  '\\<': '<',
  '\\>': '>',
  '\\{': '{',
  '\\}': '}',
};

// =============================================================================
// Levenshtein similarity (for fuzzy scoring)
// =============================================================================

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Two-row rolling array
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev.splice(0, n + 1, ...curr);
  }

  return prev[n];
}

// =============================================================================
// TextNormalizer
// =============================================================================

export class TextNormalizer {
  /**
   * Convert HTML entities to plain characters.
   * Handles named entities (&lt;), decimal (&#123;), and hex (&#x3C;).
   */
  normalizeEntities(str) {
    let result = str;
    for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
      result = result.replaceAll(entity, char);
    }
    // General hex: &#xHH;
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    );
    // General decimal: &#DDD;
    result = result.replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
    return result;
  }

  /**
   * Remove MDX backslash escapes: \< → <, \{ → {, etc.
   */
  normalizeEscapes(str) {
    let result = str;
    for (const [escape, char] of Object.entries(MDX_ESCAPES)) {
      result = result.replaceAll(escape, char);
    }
    return result;
  }

  /**
   * Normalize for comparison: strip escapes and entities, collapse whitespace.
   * After this, GFM "Air<2g" and MDX "Air\<2g" and "Air&lt;2g" all become "Air<2g".
   */
  normalize(str) {
    let result = this.normalizeEscapes(str);
    result = this.normalizeEntities(result);
    result = result.replace(/\s+/g, ' ').trim();
    return result;
  }

  /**
   * Compare two strings and return a similarity score 0.0–1.0.
   * Normalizes both strings before comparing.
   * 1.0 = identical after normalization.
   */
  compare(a, b) {
    const na = this.normalize(a);
    const nb = this.normalize(b);
    if (na === nb) return 1.0;
    const maxLen = Math.max(na.length, nb.length);
    if (maxLen === 0) return 1.0;
    return 1 - levenshtein(na, nb) / maxLen;
  }
}

// =============================================================================
// LineNormalizer  (used by FuzzyMatcher)
// =============================================================================

export class LineNormalizer {
  constructor() {
    this.textNorm = new TextNormalizer();
  }

  normalize(line) {
    return this.textNorm.normalize(line);
  }

  compare(line1, line2) {
    return this.textNorm.compare(line1, line2);
  }
}

export default TextNormalizer;
