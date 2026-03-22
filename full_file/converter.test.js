/**
 * Tests for GFM to MDX Converter
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { 
  GfmToMdxConverter, 
  HtmlFixer, 
  AdmonitionConverter,
  FrontMatterGenerator 
} from '../src/converter.js';

// =============================================================================
// Test Fixtures - INAV-specific examples
// =============================================================================

const INAV_EXAMPLES = {
  // Technical specs with angle brackets
  techSpecs: `
GPS navigation model: Pedestrian, Automotive, Air<1g, Air<2g, Air<4g.
Default is AIR_2G. Use pedestrian/Automotive with caution.
`,

  // CLI parameter ranges with braces
  cliParams: `
The value range is {0-255} for this parameter.
Set throttle to {1000-2000} microseconds.
`,

  // Mixed content
  mixed: `
# INAV Settings

GPS navigation model supports Air<1g, Air<2g, Air<4g modes.

The parameter accepts values in range {0-255}.

\`\`\`bash
# This should NOT be escaped: Air<2g or {value}
set nav_model = Air<2g
\`\`\`

Use \`Air<2g\` for most aircraft.
`,

  // HTML that needs fixing
  html: `
<br>
<img src="diagram.png" alt="wiring">
<hr>
<div class="note">
  <p>Important information here</p>
</div>
`,

  // Admonitions
  admonitions: `
> **Note:** This is important information.

> **Warning:** Be careful with this setting.

> ⚠️ This could cause issues.
`,

  // Comparison operators
  comparisons: `
For firmware versions < 4.0, use the old method.
Values > 100 may cause issues.
Use Android version <5 compatibility mode.
`,

  // Placeholders
  placeholders: `
Replace <YOUR_API_KEY> with your actual key.
Set the path to <PROJECT_ROOT>/config.
`,
};

// =============================================================================
// GfmToMdxConverter Tests
// =============================================================================

describe('GfmToMdxConverter', () => {
  let converter;

  beforeEach(() => {
    converter = new GfmToMdxConverter({
      addFrontMatter: false, // Disable for most tests to simplify assertions
    });
  });

  describe('Technical spec escaping', () => {
    it('should escape Air<1g, Air<2g patterns', () => {
      const result = converter.convert(INAV_EXAMPLES.techSpecs);
      assert.ok(result.content.includes('Air\\<1g'));
      assert.ok(result.content.includes('Air\\<2g'));
      assert.ok(result.content.includes('Air\\<4g'));
    });

    it('should track changes made', () => {
      converter.convert(INAV_EXAMPLES.techSpecs);
      const summary = converter.getSummary();
      assert.ok(summary.escapes >= 3, `Expected at least 3 escapes, got ${summary.escapes}`);
    });
  });

  describe('Brace escaping', () => {
    it('should escape literal brace ranges like {0-255}', () => {
      const result = converter.convert(INAV_EXAMPLES.cliParams);
      assert.ok(result.content.includes('\\{0-255\\}'));
      assert.ok(result.content.includes('\\{1000-2000\\}'));
    });

    it('should NOT escape braces that look like JS expressions', () => {
      const input = 'Use {variableName} in your code.';
      const result = converter.convert(input);
      // variableName looks like a valid JS identifier, so don't escape
      assert.ok(!result.content.includes('\\{variableName\\}'));
    });
  });

  describe('Code block protection', () => {
    it('should NOT escape content inside fenced code blocks', () => {
      const result = converter.convert(INAV_EXAMPLES.mixed);
      // The code block content should be unchanged
      assert.ok(result.content.includes('set nav_model = Air<2g'));
      assert.ok(!result.content.includes('set nav_model = Air\\<2g'));
    });

    it('should NOT escape content inside inline code', () => {
      const result = converter.convert(INAV_EXAMPLES.mixed);
      assert.ok(result.content.includes('`Air<2g`'));
    });

    it('should escape content outside code blocks', () => {
      const result = converter.convert(INAV_EXAMPLES.mixed);
      // The prose content should be escaped
      assert.ok(result.content.includes('Air\\<1g'));
    });
  });

  describe('HTML fixing', () => {
    it('should make <br> self-closing', () => {
      const result = converter.convert(INAV_EXAMPLES.html);
      assert.ok(result.content.includes('<br />'));
      assert.ok(!result.content.match(/<br>(?!\s*\/)/));
    });

    it('should make <img> self-closing', () => {
      const result = converter.convert(INAV_EXAMPLES.html);
      assert.ok(result.content.includes('<img'));
      assert.ok(result.content.includes('/>'));
    });

    it('should make <hr> self-closing', () => {
      const result = converter.convert(INAV_EXAMPLES.html);
      assert.ok(result.content.includes('<hr />'));
    });

    it('should convert class to className', () => {
      const result = converter.convert(INAV_EXAMPLES.html);
      assert.ok(result.content.includes('className='));
      assert.ok(!result.content.includes('class='));
    });
  });

  describe('Comparison operators', () => {
    it('should escape < in comparisons like "< 4.0"', () => {
      const result = converter.convert(INAV_EXAMPLES.comparisons);
      // Should escape standalone comparisons
      assert.ok(result.content.includes('\\<') || result.content.includes('&lt;'));
    });

    it('should escape "version<5" patterns', () => {
      const input = 'Use Android version <5 for compatibility.';
      const result = converter.convert(input);
      assert.ok(result.content.includes('\\<5') || result.content.includes('version\\<5'));
    });
  });

  describe('Placeholder escaping', () => {
    it('should escape <YOUR_API_KEY> style placeholders', () => {
      const result = converter.convert(INAV_EXAMPLES.placeholders);
      assert.ok(result.content.includes('\\<YOUR_API_KEY\\>'));
      assert.ok(result.content.includes('\\<PROJECT_ROOT\\>'));
    });

    it('should NOT escape actual HTML tags', () => {
      const input = '<div>Hello</div>';
      const result = converter.convert(input);
      assert.ok(result.content.includes('<div>'));
    });
  });

  describe('Admonition conversion', () => {
    it('should convert **Note:** blockquotes', () => {
      const converterWithAdmonitions = new GfmToMdxConverter({
        addFrontMatter: false,
        convertAdmonitions: true,
      });
      const result = converterWithAdmonitions.convert(INAV_EXAMPLES.admonitions);
      assert.ok(result.content.includes(':::note'));
      assert.ok(result.content.includes(':::'));
    });

    it('should convert **Warning:** blockquotes', () => {
      const converterWithAdmonitions = new GfmToMdxConverter({
        addFrontMatter: false,
        convertAdmonitions: true,
      });
      const result = converterWithAdmonitions.convert(INAV_EXAMPLES.admonitions);
      assert.ok(result.content.includes(':::warning'));
    });
  });

  describe('Front matter', () => {
    it('should add front matter when enabled', () => {
      const converterWithFm = new GfmToMdxConverter({
        addFrontMatter: true,
      });
      const input = '# My Title\n\nSome content here.';
      const result = converterWithFm.convert(input);
      assert.ok(result.content.startsWith('---'));
      assert.ok(result.content.includes('title: My Title'));
    });

    it('should preserve existing front matter', () => {
      const converterWithFm = new GfmToMdxConverter({
        addFrontMatter: true,
        preserveExistingFrontMatter: true,
      });
      const input = '---\ncustom: value\n---\n\n# Title\n\nContent';
      const result = converterWithFm.convert(input);
      assert.ok(result.content.includes('custom: value'));
    });

    it('should extract description from first paragraph', () => {
      const converterWithFm = new GfmToMdxConverter({
        addFrontMatter: true,
      });
      const input = '# Title\n\nThis is the description paragraph.\n\n## Section';
      const result = converterWithFm.convert(input);
      assert.ok(result.content.includes('description:'));
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content', () => {
      const result = converter.convert('');
      assert.strictEqual(result.content, '');
    });

    it('should handle content with only code blocks', () => {
      const input = '```js\nconst x = 1;\n```';
      const result = converter.convert(input);
      assert.strictEqual(result.content, input);
    });

    it('should handle nested code blocks', () => {
      const input = '````md\n```js\ncode\n```\n````';
      const result = converter.convert(input);
      // Should remain unchanged
      assert.ok(result.content.includes('```js'));
    });

    it('should handle generic types like Array<T>', () => {
      const input = 'Use Array<T> for typed arrays.';
      const result = converter.convert(input);
      assert.ok(result.content.includes('Array\\<T\\>'));
    });

    it('should handle Map<K,V> style generics', () => {
      const input = 'Use Map<string, number> for mappings.';
      const result = converter.convert(input);
      // Should escape the angle brackets
      assert.ok(result.content.includes('\\<') || !result.content.includes('<string'));
    });
  });
});

// =============================================================================
// HtmlFixer Tests
// =============================================================================

describe('HtmlFixer', () => {
  let fixer;

  beforeEach(() => {
    fixer = new HtmlFixer();
  });

  describe('fixAttributes', () => {
    it('should convert class to className', () => {
      const result = fixer.fixAttributes(' class="test"');
      assert.ok(result.includes('className='));
    });

    it('should convert for to htmlFor', () => {
      const result = fixer.fixAttributes(' for="input"');
      assert.ok(result.includes('htmlFor='));
    });
  });

  describe('fixHtmlBlock', () => {
    it('should make void elements self-closing', () => {
      const result = fixer.fixHtmlBlock('<br><hr><img src="x">');
      assert.ok(result.includes('<br />'));
      assert.ok(result.includes('<hr />'));
      assert.ok(result.includes('/>'));
    });

    it('should preserve attributes', () => {
      const result = fixer.fixHtmlBlock('<img src="test.png" alt="test">');
      assert.ok(result.includes('src="test.png"'));
      assert.ok(result.includes('alt="test"'));
    });
  });

  describe('validateHtml', () => {
    it('should report class attribute warnings', () => {
      const issues = fixer.validateHtml('<div class="test">content</div>');
      assert.ok(issues.some(i => i.type === 'jsx_compat'));
    });

    it('should handle valid HTML', () => {
      const issues = fixer.validateHtml('<div><p>Valid</p></div>');
      const errors = issues.filter(i => i.severity === 'error');
      assert.strictEqual(errors.length, 0);
    });
  });
});

// =============================================================================
// AdmonitionConverter Tests
// =============================================================================

describe('AdmonitionConverter', () => {
  let converter;

  beforeEach(() => {
    converter = new AdmonitionConverter();
  });

  describe('convertBlockquote', () => {
    it('should convert Note blockquotes', () => {
      const input = '> **Note:** Important info';
      const result = converter.convertBlockquote(input);
      assert.ok(result.includes(':::note'));
      assert.ok(result.includes('Important info'));
    });

    it('should convert Warning blockquotes', () => {
      const input = '> **Warning:** Be careful';
      const result = converter.convertBlockquote(input);
      assert.ok(result.includes(':::warning'));
    });

    it('should convert emoji-based admonitions', () => {
      const input = '> ⚠️ Warning message';
      const result = converter.convertBlockquote(input);
      assert.ok(result.includes(':::warning'));
    });

    it('should return null for non-admonition blockquotes', () => {
      const input = '> Just a regular quote';
      const result = converter.convertBlockquote(input);
      assert.strictEqual(result, null);
    });
  });

  describe('convertAll', () => {
    it('should convert multiple admonitions', () => {
      const input = `
> **Note:** First note

Some text

> **Warning:** A warning
`;
      const result = converter.convertAll(input);
      assert.ok(result.includes(':::note'));
      assert.ok(result.includes(':::warning'));
    });
  });
});

// =============================================================================
// FrontMatterGenerator Tests
// =============================================================================

describe('FrontMatterGenerator', () => {
  let generator;

  beforeEach(() => {
    generator = new FrontMatterGenerator();
  });

  describe('generate', () => {
    it('should generate valid YAML front matter', () => {
      const result = generator.generate({
        title: 'Test Title',
        sidebarPosition: 1,
        sidebarLabel: 'Test',
      });
      assert.ok(result.startsWith('---'));
      assert.ok(result.endsWith('---'));
      assert.ok(result.includes('title: Test Title'));
      assert.ok(result.includes('sidebar_position: 1'));
    });

    it('should handle arrays (tags)', () => {
      const result = generator.generate({
        title: 'Test',
        tags: ['gps', 'navigation'],
      });
      assert.ok(result.includes('tags:'));
      assert.ok(result.includes('- gps'));
      assert.ok(result.includes('- navigation'));
    });

    it('should quote strings with special characters', () => {
      const result = generator.generate({
        title: 'Test: A Title',
      });
      assert.ok(result.includes('"Test: A Title"'));
    });
  });

  describe('extractTitle', () => {
    it('should extract H1 title', () => {
      const content = '# My Great Title\n\nContent here';
      const title = generator.extractTitle(content);
      assert.strictEqual(title, 'My Great Title');
    });

    it('should return null if no H1', () => {
      const content = '## Not H1\n\nContent';
      const title = generator.extractTitle(content);
      assert.strictEqual(title, null);
    });
  });

  describe('extractDescription', () => {
    it('should extract first paragraph after H1', () => {
      const content = '# Title\n\nThis is the description.\n\n## Section';
      const desc = generator.extractDescription(content);
      assert.strictEqual(desc, 'This is the description.');
    });

    it('should truncate long descriptions', () => {
      const longPara = 'A'.repeat(200);
      const content = `# Title\n\n${longPara}\n\n## Section`;
      const desc = generator.extractDescription(content, 50);
      assert.ok(desc.length <= 50);
      assert.ok(desc.endsWith('...'));
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  it('should handle a complete INAV-style document', () => {
    const input = `
# GPS Configuration

GPS navigation model: Air<1g, Air<2g, Air<4g.

> **Note:** Use Air<2g for most setups.

## Settings

The value range is {0-255}.

\`\`\`bash
set gps_model = Air<2g
\`\`\`

<br>
<img src="wiring.png" class="diagram">

For firmware versions <4.0, see legacy docs.
`;

    const converter = new GfmToMdxConverter({
      addFrontMatter: true,
      convertAdmonitions: true,
    });

    const result = converter.convert(input);

    // Check front matter
    assert.ok(result.content.includes('---'));
    assert.ok(result.content.includes('title: GPS Configuration'));

    // Check escaping
    assert.ok(result.content.includes('Air\\<1g'));
    assert.ok(result.content.includes('\\{0-255\\}'));

    // Check code block protection
    assert.ok(result.content.includes('set gps_model = Air<2g'));

    // Check HTML fixing
    assert.ok(result.content.includes('<br />'));
    assert.ok(result.content.includes('className='));

    // Check admonitions
    assert.ok(result.content.includes(':::note'));

    // Summary
    const summary = converter.getSummary();
    assert.ok(summary.totalChanges > 0);
  });
});
