/**
 * Transform: JSX Character Escaping
 *
 * Escapes characters that would be interpreted as JSX/MDX syntax
 * when they appear as literal text:
 *   - word<digit  e.g. "Air<2g", "version<5"    → word\<digit
 *   - word<Word>  e.g. "Map<K,V>", "Array<T>"   → word\<Word\>
 *   - <ALLCAPS>   e.g. "<PLACEHOLDER>"           → \<ALLCAPS\>
 *   - < not followed by valid tag/safe char      → \<
 *   - {literal}   e.g. "{range: 0-100}"          → \{range: 0-100\}
 *
 * NOT escaped (safe in MDX — not parsed as JSX elements):
 *   - < followed by a space (e.g. "speed < 3m/s") — space before text means not a tag
 *   - > in any position (MDX only treats < as a tag-opening, never >)
 *
 * Code blocks and inline code are protected (not escaped).
 *
 * Interface: transform(content, ctx?) => string
 */

/**
 * Find all protected regions (fenced code blocks and inline code)
 * that should not be modified.  Returns sorted, non-overlapping ranges.
 *
 * @param {string} content
 * @returns {Array<{start: number, end: number}>}
 */
function findProtected(content) {
  const regions = [];
  let m;

  // Fenced code blocks
  const fenceRe = /^(`{3,}|~{3,})([^\n]*)\n[\s\S]*?\n\1/gm;
  while ((m = fenceRe.exec(content)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // Inline code
  const inlineRe = /`[^`\n]+`/g;
  while ((m = inlineRe.exec(content)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  return regions.sort((a, b) => a.start - b.start);
}

/**
 * Escape JSX-problematic characters in markdown content.
 *
 * @param {string} content
 * @returns {string}
 */
export function transform(content) {
  const regions = findProtected(content);
  const out = [];
  let i = 0;
  let ri = 0; // advancing index into sorted protected regions

  while (i < content.length) {
    // Advance past regions we've already passed
    while (ri < regions.length && regions[ri].end <= i) ri++;

    const region = ri < regions.length ? regions[ri] : null;

    // At the start of a protected region — copy it whole
    if (region && region.start === i) {
      out.push(content.slice(region.start, region.end));
      i = region.end;
      continue;
    }

    // Inside a protected region (shouldn't happen after the above, but safe)
    if (region && i >= region.start && i < region.end) {
      out.push(content[i++]);
      continue;
    }

    const rem = content.slice(i);

    // word<digit  e.g. "Air<2g"
    const techSpec = rem.match(/^(\w+)<(\d+\w*)/);
    if (techSpec) {
      out.push(techSpec[1] + '\\<' + techSpec[2]);
      i += techSpec[0].length;
      continue;
    }

    // word<Word>  e.g. "Map<K,V>", "Array<T>"
    const generic = rem.match(/^(\w+)<(\w+)>/);
    if (generic) {
      out.push(generic[1] + '\\<' + generic[2] + '\\>');
      i += generic[0].length;
      continue;
    }

    // <ALLCAPS>  placeholder
    const placeholder = rem.match(/^<([A-Z][A-Z0-9_]*)>/);
    if (placeholder) {
      out.push('\\<' + placeholder[1] + '\\>');
      i += placeholder[0].length;
      continue;
    }

    // Comparison / range operators: <=, <digit (without a space)
    // These cause MDX parse errors because the parser tries to read a tag name
    // after the '<' and fails on '=' or a digit.
    // Note: '< digit' WITH a space (e.g. "< 3m") is safe — the space tells MDX
    // it's not a tag — so we only escape the no-space variants.
    const ltNoSpace = rem.match(/^(<[=]?\d)/);
    if (ltNoSpace) {
      // Escape only the '<'
      out.push('\\<');
      out.push(rem[1]); // The char right after '<' (= or digit)
      i += 2;
      continue;
    }

    // < not followed by a valid JSX/HTML tag-name start character — escape it.
    // Safe (not JSX): < followed by a space or '>' (clearly not a tag).
    // Unsafe: < followed by digit, =, or other non-tag chars that confuse parsers.
    if (content[i] === '<' && !rem.match(/^<[a-zA-Z\/! ]/)) {
      out.push('\\<');
      i++;
      continue;
    }

    // {literal_content} — escape braces that look like template literals not JSX
    if (content[i] === '{') {
      const braces = rem.match(/^\{([^}]*)\}/);
      if (braces) {
        const inner = braces[1];
        if (/^[\w\s\-,.:\\/]+$/.test(inner) && !/^[a-z_$][\w$]*$/i.test(inner.trim())) {
          out.push('\\{' + inner + '\\}');
          i += braces[0].length;
          continue;
        }
      }
    }

    out.push(content[i++]);
  }

  return out.join('');
}

export default transform;
