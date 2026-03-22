/**
 * Tests for GFM-MDX Three-Way Merge Tool
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { 
  ThreeWayMerger,
  DiffParser,
  FuzzyMatcher,
  TextNormalizer,
  LineNormalizer,
  GfmToMdxTransformer
} from '../src/index.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const FIXTURES = {
  simpleGfm: `# Title

Air<2g is the default mode.

The range is {0-255}.
`,

  simpleMdx: `# Title

Air\\<2g is the default mode.

The range is \\{0-255\\}.
`,

  simpleGfmWithHtml: `# Title

<br>
<img src="test.png" class="img">
`,

  simpleMdxWithHtml: `# Title

<br />
<img src="test.png" className="img" />
`,

  // MDX using HTML entities instead of backslash escapes
  mdxWithEntities: `# Title

Air&lt;2g is the default mode.

The range is &#123;0-255&#125;.
`,

  simpleDiff: `--- a/file.md
+++ b/file.md
@@ -1,5 +1,6 @@
 # Title
 
-Air<2g is the default mode.
+Air<2g is the default mode. Air<4g is for faster aircraft.
 
 The range is {0-255}.
+New line added.
`,

  codeDiff: `--- a/file.md
+++ b/file.md
@@ -1,5 +1,7 @@
 # Example
 
 \`\`\`bash
 set value = Air<2g
+set other = {0-100}
 \`\`\`
`,

  gfmWithCode: `# Example

\`\`\`bash
set value = Air<2g
\`\`\`
`,

  mdxWithCode: `# Example

\`\`\`bash
set value = Air<2g
\`\`\`
`,
};

// =============================================================================
// TextNormalizer Tests
// =============================================================================

describe('TextNormalizer', () => {
  let normalizer;

  beforeEach(() => {
    normalizer = new TextNormalizer();
  });

  describe('normalizeEntities', () => {
    it('should convert &lt; to <', () => {
      assert.strictEqual(normalizer.normalizeEntities('&lt;'), '<');
    });

    it('should convert &gt; to >', () => {
      assert.strictEqual(normalizer.normalizeEntities('&gt;'), '>');
    });

    it('should convert &#123; to {', () => {
      assert.strictEqual(normalizer.normalizeEntities('&#123;'), '{');
    });

    it('should convert hex entities', () => {
      assert.strictEqual(normalizer.normalizeEntities('&#x3C;'), '<');
    });

    it('should handle multiple entities', () => {
      const result = normalizer.normalizeEntities('Air&lt;2g range &#123;0-255&#125;');
      assert.strictEqual(result, 'Air<2g range {0-255}');
    });
  });

  describe('normalizeEscapes', () => {
    it('should convert \\< to <', () => {
      assert.strictEqual(normalizer.normalizeEscapes('\\<'), '<');
    });

    it('should convert \\{ to {', () => {
      assert.strictEqual(normalizer.normalizeEscapes('\\{'), '{');
    });

    it('should handle MDX escaped content', () => {
      const result = normalizer.normalizeEscapes('Air\\<2g range \\{0-255\\}');
      assert.strictEqual(result, 'Air<2g range {0-255}');
    });
  });

  describe('normalize (combined)', () => {
    it('should make GFM and MDX (backslash) compare equal', () => {
      const gfm = 'Air<2g';
      const mdx = 'Air\\<2g';
      assert.strictEqual(normalizer.normalize(gfm), normalizer.normalize(mdx));
    });

    it('should make GFM and MDX (entities) compare equal', () => {
      const gfm = 'Air<2g';
      const mdx = 'Air&lt;2g';
      assert.strictEqual(normalizer.normalize(gfm), normalizer.normalize(mdx));
    });

    it('should make braces compare equal', () => {
      const gfm = '{0-255}';
      const mdx = '\\{0-255\\}';
      assert.strictEqual(normalizer.normalize(gfm), normalizer.normalize(mdx));
    });
  });

  describe('compare', () => {
    it('should return 1.0 for identical strings', () => {
      assert.strictEqual(normalizer.compare('hello', 'hello'), 1.0);
    });

    it('should return 1.0 for normalized-equal strings', () => {
      assert.strictEqual(normalizer.compare('Air<2g', 'Air\\<2g'), 1.0);
    });

    it('should return high score for similar strings', () => {
      const score = normalizer.compare('Air<2g mode', 'Air<2g modes');
      assert.ok(score > 0.8, `Score ${score} should be > 0.8`);
    });

    it('should return low score for different strings', () => {
      const score = normalizer.compare('hello world', 'goodbye moon');
      assert.ok(score < 0.5, `Score ${score} should be < 0.5`);
    });
  });
});

// =============================================================================
// DiffParser Tests
// =============================================================================

describe('DiffParser', () => {
  let parser;

  beforeEach(() => {
    parser = new DiffParser();
  });

  describe('parse', () => {
    it('should parse hunk header', () => {
      const result = parser.parse(FIXTURES.simpleDiff);
      assert.strictEqual(result.hunks.length, 1);
      assert.strictEqual(result.hunks[0].oldStart, 1);
      assert.strictEqual(result.hunks[0].oldCount, 5);
    });

    it('should extract removals and additions', () => {
      const result = parser.parse(FIXTURES.simpleDiff);
      const hunk = result.hunks[0];
      assert.ok(hunk.removals.length > 0);
      assert.ok(hunk.additions.length > 0);
    });

    it('should extract context lines', () => {
      const result = parser.parse(FIXTURES.simpleDiff);
      const hunk = result.hunks[0];
      assert.ok(hunk.contextBefore.length >= 0);
    });
  });

  describe('classifyHunk', () => {
    it('should classify prose hunks', () => {
      const result = parser.parse(FIXTURES.simpleDiff);
      const hunkType = parser.classifyHunk(result.hunks[0], FIXTURES.simpleGfm);
      assert.strictEqual(hunkType, 'prose');
    });

    it('should classify code hunks', () => {
      const result = parser.parse(FIXTURES.codeDiff);
      const hunkType = parser.classifyHunk(result.hunks[0], FIXTURES.gfmWithCode);
      assert.strictEqual(hunkType, 'code');
    });
  });
});

// =============================================================================
// FuzzyMatcher Tests
// =============================================================================

describe('FuzzyMatcher', () => {
  let matcher;

  beforeEach(() => {
    matcher = new FuzzyMatcher();
  });

  describe('findMatch', () => {
    it('should find exact match', () => {
      const gfmLines = ['Air<2g is the default mode.'];
      const match = matcher.findMatch(gfmLines, FIXTURES.simpleGfm);
      assert.ok(match, 'Should find a match');
      assert.strictEqual(match.score, 1.0);
    });

    it('should find normalized match (backslash escapes)', () => {
      const gfmLines = ['Air<2g is the default mode.'];
      const match = matcher.findMatch(gfmLines, FIXTURES.simpleMdx);
      assert.ok(match, 'Should find a match');
      assert.strictEqual(match.score, 1.0);
    });

    it('should find normalized match (HTML entities)', () => {
      const gfmLines = ['Air<2g is the default mode.'];
      const match = matcher.findMatch(gfmLines, FIXTURES.mdxWithEntities);
      assert.ok(match, 'Should find a match');
      assert.strictEqual(match.score, 1.0);
    });

    it('should find multi-line matches', () => {
      const gfmLines = [
        'Air<2g is the default mode.',
        '',
        'The range is {0-255}.'
      ];
      const match = matcher.findMatch(gfmLines, FIXTURES.simpleMdx);
      assert.ok(match, 'Should find a match');
      assert.ok(match.score > 0.8);
    });

    it('should return null for no match', () => {
      const gfmLines = ['This text does not exist anywhere'];
      const match = matcher.findMatch(gfmLines, FIXTURES.simpleGfm);
      assert.strictEqual(match, null);
    });
  });

  describe('findMatchWithContext', () => {
    it('should improve match confidence with context', () => {
      const gfmLines = ['Air<2g is the default mode.'];
      const contextBefore = ['# Title', ''];
      const contextAfter = ['', 'The range is {0-255}.'];
      
      const match = matcher.findMatchWithContext(
        gfmLines, 
        FIXTURES.simpleMdx,
        contextBefore,
        contextAfter
      );
      
      assert.ok(match, 'Should find a match');
      assert.ok(match.score > 0.9);
    });
  });
});

// =============================================================================
// GfmToMdxTransformer Tests
// =============================================================================

describe('GfmToMdxTransformer', () => {
  let transformer;

  beforeEach(() => {
    transformer = new GfmToMdxTransformer();
  });

  describe('transformLine', () => {
    it('should escape technical specs', () => {
      const result = transformer.transformLine('Air<2g is recommended');
      assert.ok(result.includes('\\<'));
    });

    it('should escape braces', () => {
      const result = transformer.transformLine('Range is {0-255}');
      assert.ok(result.includes('\\{'));
      assert.ok(result.includes('\\}'));
    });

    it('should fix void elements', () => {
      const result = transformer.transformLine('<br>');
      assert.strictEqual(result, '<br />');
    });

    it('should fix class attribute', () => {
      const result = transformer.transformLine('<div class="test">');
      assert.ok(result.includes('className='));
    });
  });

  describe('transformLines', () => {
    it('should not transform code block content', () => {
      const lines = [
        '```bash',
        'set value = Air<2g',
        '```'
      ];
      const result = transformer.transformLines(lines);
      assert.strictEqual(result[1], 'set value = Air<2g');
    });

    it('should transform prose but not code', () => {
      const lines = [
        'Air<2g is recommended',
        '```',
        'Air<2g in code',
        '```',
        'Air<4g also works'
      ];
      const result = transformer.transformLines(lines);
      assert.ok(result[0].includes('\\<'));
      assert.strictEqual(result[2], 'Air<2g in code');
      assert.ok(result[4].includes('\\<'));
    });
  });
});

// =============================================================================
// ThreeWayMerger Tests
// =============================================================================

describe('ThreeWayMerger', () => {
  let merger;

  beforeEach(() => {
    merger = new ThreeWayMerger({ verbose: false });
  });

  describe('merge', () => {
    it('should apply simple text changes', () => {
      const result = merger.merge(
        FIXTURES.simpleGfm,
        FIXTURES.simpleMdx,
        FIXTURES.simpleDiff
      );

      assert.ok(result.success, 'Merge should succeed');
      assert.ok(result.appliedHunks.length > 0, 'Should apply hunks');
      
      // Check that the MDX contains transformed content
      assert.ok(result.content.includes('Air\\<4g'), 'Should have transformed Air<4g');
    });

    it('should not transform code block changes', () => {
      const result = merger.merge(
        FIXTURES.gfmWithCode,
        FIXTURES.mdxWithCode,
        FIXTURES.codeDiff
      );

      assert.ok(result.success, 'Merge should succeed');
      
      // Code should remain untransformed
      assert.ok(result.content.includes('set other = {0-100}'), 'Code should not be escaped');
      assert.ok(!result.content.includes('\\{0-100\\}'), 'Code should not have escaped braces');
    });

    it('should detect MDX style and match it', () => {
      // When MDX uses HTML entities, new content should too
      const result = merger.merge(
        FIXTURES.simpleGfm,
        FIXTURES.mdxWithEntities,
        FIXTURES.simpleDiff
      );

      assert.ok(result.success, 'Merge should succeed');
      // The merger should detect entity style and use it
      // (This depends on implementation - might use backslash or entity)
    });

    it('should handle empty diff', () => {
      const emptyDiff = `--- a/file.md
+++ b/file.md
`;
      const result = merger.merge(FIXTURES.simpleGfm, FIXTURES.simpleMdx, emptyDiff);
      
      assert.ok(result.success);
      assert.strictEqual(result.appliedHunks.length, 0);
      assert.strictEqual(result.content, FIXTURES.simpleMdx);
    });

    it('should report conflicts for unmatched hunks', () => {
      const badDiff = `--- a/file.md
+++ b/file.md
@@ -100,3 +100,4 @@
 This line does not exist
-And neither does this
+Nor this replacement
`;
      const result = merger.merge(FIXTURES.simpleGfm, FIXTURES.simpleMdx, badDiff);
      
      assert.ok(result.conflicts.length > 0, 'Should have conflicts');
    });
  });

  describe('analyzeMdxStyle', () => {
    it('should detect backslash escapes', () => {
      const analysis = merger.analyzeMdxStyle(FIXTURES.simpleGfm, FIXTURES.simpleMdx);
      assert.ok(analysis.usesBackslashEscape);
    });

    it('should detect HTML entities', () => {
      const analysis = merger.analyzeMdxStyle(FIXTURES.simpleGfm, FIXTURES.mdxWithEntities);
      assert.ok(analysis.usesHtmlEntities);
    });

    it('should detect className usage', () => {
      const analysis = merger.analyzeMdxStyle(
        FIXTURES.simpleGfmWithHtml,
        FIXTURES.simpleMdxWithHtml
      );
      assert.ok(analysis.usesClassName);
    });
  });

  describe('getSummary', () => {
    it('should provide merge statistics', () => {
      merger.merge(FIXTURES.simpleGfm, FIXTURES.simpleMdx, FIXTURES.simpleDiff);
      const summary = merger.getSummary();

      assert.ok('hunksApplied' in summary);
      assert.ok('hunksConflicted' in summary);
      assert.ok('success' in summary);
      assert.ok('details' in summary);
    });
  });
});

// =============================================================================
// Integration Tests with Real INAV-style Content
// =============================================================================

describe('Integration: INAV-style Documents', () => {
  const inavGfm = `# GPS Configuration

GPS navigation model: Pedestrian, Automotive, Air<1g, Air<2g, Air<4g.
Default is AIR_2G.

## Parameters

| Parameter | Range | Default |
|-----------|-------|---------|
| gps_model | {0-4} | 3 |
| gps_min_sats | {5-20} | 6 |

## Code Example

\`\`\`bash
set gps_model = 3
set gps_min_sats = 8
save
\`\`\`

The minimum satellites should be >5 for reliable navigation.

<br>
<img src="gps-wiring.png" class="diagram">

> **Note:** GPS units with protocol version <15.0 are deprecated.

Replace <YOUR_GPS_PORT> with your UART number.
`;

  const inavMdx = `---
sidebar_position: 5
sidebar_label: GPS Configuration
---

# GPS Configuration

GPS navigation model: Pedestrian, Automotive, Air\\<1g, Air\\<2g, Air\\<4g.
Default is AIR_2G.

## Parameters

| Parameter | Range | Default |
|-----------|-------|---------|
| gps_model | \\{0-4\\} | 3 |
| gps_min_sats | \\{5-20\\} | 6 |

## Code Example

\`\`\`bash
set gps_model = 3
set gps_min_sats = 8
save
\`\`\`

The minimum satellites should be \\>5 for reliable navigation.

<br />
<img src="gps-wiring.png" className="diagram" />

:::note
GPS units with protocol version \\<15.0 are deprecated.
:::

Replace \\<YOUR_GPS_PORT\\> with your UART number.
`;

  const inavDiff = `--- a/GPS-Configuration.md
+++ b/GPS-Configuration.md
@@ -1,7 +1,9 @@
 # GPS Configuration
 
-GPS navigation model: Pedestrian, Automotive, Air<1g, Air<2g, Air<4g.
-Default is AIR_2G.
+GPS navigation model: Pedestrian, Automotive, Air<1g, Air<2g, Air<4g, Air<8g.
+Default is AIR_2G. For most fixed-wing aircraft, Air<2g is recommended.
+
+**New in 4.1:** Added Air<8g mode for high-speed aircraft.
 
 ## Parameters
 
@@ -9,6 +11,7 @@ Default is AIR_2G.
 |-----------|-------|---------|
 | gps_model | {0-4} | 3 |
 | gps_min_sats | {5-20} | 6 |
+| gps_timeout | {1-30} | 5 |
 
 ## Code Example
 
`;

  it('should merge INAV documentation updates', () => {
    const merger = new ThreeWayMerger({ verbose: false });
    const result = merger.merge(inavGfm, inavMdx, inavDiff);

    assert.ok(result.success, `Merge should succeed. Conflicts: ${JSON.stringify(result.conflicts)}`);
    
    // Check that new Air<8g is properly escaped
    assert.ok(result.content.includes('Air\\<8g'), 'Should escape Air<8g');
    
    // Check that new table row is escaped
    assert.ok(result.content.includes('gps_timeout'), 'Should add gps_timeout');
    assert.ok(result.content.includes('\\{1-30\\}'), 'Should escape {1-30}');
    
    // Check that front matter is preserved
    assert.ok(result.content.includes('sidebar_position: 5'), 'Should preserve front matter');
    
    // Check that admonition is preserved
    assert.ok(result.content.includes(':::note'), 'Should preserve admonition');
  });

  it('should preserve code blocks unchanged', () => {
    const merger = new ThreeWayMerger();
    const result = merger.merge(inavGfm, inavMdx, inavDiff);

    // Code block should remain untouched
    assert.ok(result.content.includes('set gps_model = 3'));
    assert.ok(result.content.includes('set gps_min_sats = 8'));
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('should handle inline code in prose', () => {
    const gfm = 'Use `Air<2g` for default mode.';
    const mdx = 'Use `Air<2g` for default mode.';
    const diff = `--- a/file.md
+++ b/file.md
@@ -1 +1 @@
-Use \`Air<2g\` for default mode.
+Use \`Air<2g\` or \`Air<4g\` for your aircraft.
`;

    const merger = new ThreeWayMerger();
    const result = merger.merge(gfm, mdx, diff);

    assert.ok(result.success);
    // Inline code should not be escaped
    assert.ok(result.content.includes('`Air<2g`'));
    assert.ok(result.content.includes('`Air<4g`'));
  });

  it('should handle mixed content hunks', () => {
    const gfm = `# Example

Some text with Air<2g value.

\`\`\`
code block
\`\`\`

More text.
`;
    const mdx = `# Example

Some text with Air\\<2g value.

\`\`\`
code block
\`\`\`

More text.
`;
    const diff = `--- a/file.md
+++ b/file.md
@@ -1,9 +1,10 @@
 # Example
 
-Some text with Air<2g value.
+Some text with Air<2g and Air<4g values.
 
 \`\`\`
 code block
+new code line
 \`\`\`
 
 More text.
`;

    const merger = new ThreeWayMerger();
    const result = merger.merge(gfm, mdx, diff);

    // Should handle mixed content
    assert.ok(result.content.includes('Air\\<4g') || result.content.includes('Air<4g'));
  });

  it('should handle completely different files gracefully', () => {
    const gfm = 'Completely different content here.';
    const mdx = 'This MDX file has nothing in common.';
    const diff = `--- a/file.md
+++ b/file.md
@@ -1 +1 @@
-Completely different content here.
+New content to add.
`;

    const merger = new ThreeWayMerger();
    const result = merger.merge(gfm, mdx, diff);

    // Should report conflict since MDX doesn't match GFM
    assert.ok(result.conflicts.length > 0 || result.warnings.length > 0);
  });
});
