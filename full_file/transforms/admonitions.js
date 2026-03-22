/**
 * Transform: Admonition Conversion
 *
 * Converts wiki patterns to Docusaurus admonitions (:::type blocks).
 *
 * Patterns converted (matching manual conversion):
 *
 * 1. GitHub Alert syntax in blockquotes:
 *      >[!NOTE]             → :::note
 *      >[!WARNING]          → :::warning
 *      >[!TIP]              → :::tip
 *      >[!IMPORTANT]        → :::info
 *      >[!CAUTION]          → :::danger
 *
 * 2. Bold-keyword blockquotes:
 *      > **Note:** text     → :::note
 *      > **Warning:** text  → :::warning
 *      > ⚠️ text            → :::warning
 *
 * 3. HR-wrapped paragraphs (Setext-style callouts):
 *      ---                  → :::warning
 *      Warning: text
 *      ---
 *
 * 4. Document-intro **Important:** paragraph (first content block):
 *      **Important:** text  → :::info  (only when it is the first paragraph)
 *
 * NOT converted:
 *   - **Note:** paragraphs in the middle of content (left as bold text)
 *   - **Warning:** paragraphs in the middle of content
 *
 * Interface: transform(content, ctx?) => string
 */

const KEYWORD_TYPE = {
  note:      'note',
  tip:       'tip',
  warning:   'warning',
  important: 'info',
  caution:   'danger',
  danger:    'danger',
  info:      'info',
};

function keywordToType(kw) {
  return KEYWORD_TYPE[kw.toLowerCase()] || 'note';
}

// =============================================================================
// Patterns 1 & 2: Blockquote-based admonitions
// =============================================================================

const BLOCKQUOTE_PATTERNS = [
  // GitHub Alert syntax
  { re: /^>\s*\[!note\]\s*/im,      type: 'note' },
  { re: /^>\s*\[!tip\]\s*/im,       type: 'tip' },
  { re: /^>\s*\[!warning\]\s*/im,   type: 'warning' },
  { re: /^>\s*\[!important\]\s*/im, type: 'info' },
  { re: /^>\s*\[!caution\]\s*/im,   type: 'danger' },
  // Bold-keyword blockquote
  { re: /^>\s*\*\*Note:?\*\*\s*/im,      type: 'note' },
  { re: /^>\s*\*\*Warning:?\*\*\s*/im,   type: 'warning' },
  { re: /^>\s*\*\*Tip:?\*\*\s*/im,       type: 'tip' },
  { re: /^>\s*\*\*Important:?\*\*\s*/im, type: 'info' },
  { re: /^>\s*\*\*Caution:?\*\*\s*/im,   type: 'danger' },
  { re: /^>\s*\*\*Danger:?\*\*\s*/im,    type: 'danger' },
  // Emoji blockquote
  { re: /^>\s*⚠️\s*/im,  type: 'warning' },
  { re: /^>\s*ℹ️\s*/im,  type: 'info' },
  { re: /^>\s*💡\s*/im,  type: 'tip' },
];

function convertBlockquote(block) {
  for (const { re, type } of BLOCKQUOTE_PATTERNS) {
    if (re.test(block)) {
      const body = block.replace(re, '').replace(/^>\s?/gm, '').trim();
      return `:::${type}\n${body}\n:::`;
    }
  }
  return null;
}

function convertBlockquotes(content) {
  return content.replace(/^((?:>.*\n?)+)/gm, (match, _p1, offset, str) => {
    const converted = convertBlockquote(match);
    if (!converted) return match;
    const after = str.slice(offset + match.length);
    const needsBlank = after.length > 0 && !after.startsWith('\n');
    return converted + (needsBlank ? '\n\n' : '\n');
  });
}

// =============================================================================
// Pattern 3: HR-wrapped text: ---\nWarning: text\n---
// =============================================================================

const HR_WRAP_RE =
  /^---\n((Warning|Note|Important|Caution|Danger|Tip):[^\n]+(?:\n(?!---)[^\n]+)*)\n---$/gim;

function convertHrWrapped(content) {
  return content.replace(HR_WRAP_RE, (match, text, keyword) => {
    const type = keywordToType(keyword);
    return `:::${type}\n${text}\n:::`;
  });
}

// =============================================================================
// Pattern 4: Document-intro **Important:** paragraph (FIRST content paragraph only)
// =============================================================================

const INTRO_IMPORTANT_RE = /^\*\*Important:\*\*\s+(.+(?:\n(?!\n).+)*)/;

function convertIntroImportant(content) {
  // Only convert if **Important:** is the very first paragraph (before any heading)
  const firstNonBlank = content.trimStart();
  if (!INTRO_IMPORTANT_RE.test(firstNonBlank.split(/\n\n/)[0])) return content;

  return content.replace(
    /^(\*\*Important:\*\*\s+[^\n]+(?:\n(?!\n)[^\n]+)*)/m,
    (match) => `:::info\n${match}\n:::`
  );
}

// =============================================================================
// Main transform
// =============================================================================

/**
 * Convert all admonition patterns in content.
 *
 * @param {string} content
 * @returns {string}
 */
export function transform(content) {
  content = convertHrWrapped(content);
  content = convertBlockquotes(content);
  content = convertIntroImportant(content);
  return content;
}

export default transform;
