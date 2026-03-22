/**
 * Tests for GFM to MDX Converter
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { GfmToMdxConverter } from './converter.js';
import { transform as demoteH1 } from './transforms/h1-demote.js';
import { transform as fixHtml } from './transforms/html-fix.js';
import { transform as convertAdmonitions } from './transforms/admonitions.js';
import { transform as addFrontMatter, extractTitle, stemToTitle } from './transforms/front-matter.js';
import { LinkRewriter } from './transforms/links.js';
import { ImageRewriter } from './transforms/images.js';

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

  // Admonitions - legacy bold-keyword style
  admonitions: `
> **Note:** This is important information.

> **Warning:** Be careful with this setting.

> ⚠️ This could cause issues.
`,

  // GitHub Alert syntax (>[!TYPE]) - dominant format in current INAV wiki
  githubAlerts: `
>[!NOTE]
>This is a note.

>[!Warning]
>Be careful with this setting.

>[!TIP]
>This is a helpful tip.

>[!IMPORTANT]
>This is important.

>[!CAUTION]
>Proceed with caution.
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
    it('should not escape "< 4.0" (space before digit is safe in MDX)', () => {
      const input = 'For firmware versions < 4.0, use the old method.';
      const result = converter.convert(input);
      assert.ok(result.content.includes('< 4.0'), 'Space-before-digit should be preserved');
    });

    it('should escape "<5" patterns (no space, confuses MDX parser)', () => {
      const input = 'Use Android version <5 for compatibility.';
      const result = converter.convert(input);
      assert.ok(result.content.includes('\\<5'), `Expected \\<5, got: ${result.content}`);
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
      const result = converter.convert(INAV_EXAMPLES.admonitions);
      assert.ok(result.content.includes(':::note'));
    });

    it('should convert **Warning:** blockquotes', () => {
      const result = converter.convert(INAV_EXAMPLES.admonitions);
      assert.ok(result.content.includes(':::warning'));
    });

    it('should convert >[!NOTE] GitHub alert syntax', () => {
      const result = converter.convert(INAV_EXAMPLES.githubAlerts);
      assert.ok(result.content.includes(':::note'), 'should produce :::note');
      assert.ok(!result.content.includes('>[!NOTE]'), 'should remove >[!NOTE]');
    });

    it('should convert >[!Warning] (mixed case)', () => {
      const result = converter.convert(INAV_EXAMPLES.githubAlerts);
      assert.ok(result.content.includes(':::warning'));
    });

    it('should convert >[!TIP] to :::tip', () => {
      const result = converter.convert(INAV_EXAMPLES.githubAlerts);
      assert.ok(result.content.includes(':::tip'));
    });

    it('should convert >[!IMPORTANT] to :::info', () => {
      const result = converter.convert(INAV_EXAMPLES.githubAlerts);
      assert.ok(result.content.includes(':::info'));
    });

    it('should convert >[!CAUTION] to :::danger', () => {
      const result = converter.convert(INAV_EXAMPLES.githubAlerts);
      assert.ok(result.content.includes(':::danger'));
    });

    it('should preserve body text in GitHub alerts', () => {
      const input = '>[!NOTE]\n>This is a note.\n';
      const result = converter.convert(input);
      assert.ok(result.content.includes('This is a note.'));
    });

    it('should handle multiline GitHub alert body', () => {
      const input = '>[!NOTE]\n>Line one.\n>Line two.\n';
      const result = converter.convert(input);
      assert.ok(result.content.includes(':::note'));
      assert.ok(result.content.includes('Line one.'));
      assert.ok(result.content.includes('Line two.'));
    });
  });

  describe('Front matter', () => {
    it('should add front matter when enabled', () => {
      const converterWithFm = new GfmToMdxConverter({ addFrontMatter: true });
      const input = '# My Title\n\nSome content here.';
      const result = converterWithFm.convert(input);
      assert.ok(result.content.startsWith('---'));
      assert.ok(result.content.includes('title:'));
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
  });

  describe('Edge cases', () => {
    it('should handle content with only code blocks', () => {
      const input = '```js\nconst x = 1;\n```';
      const result = converter.convert(input);
      assert.ok(result.content.includes('const x = 1;'));
    });

    it('should handle nested code blocks', () => {
      const input = '````md\n```js\ncode\n```\n````';
      const result = converter.convert(input);
      assert.ok(result.content.includes('```js'));
    });

    it('should handle generic types like Array<T>', () => {
      const input = 'Use Array<T> for typed arrays.';
      const result = converter.convert(input);
      assert.ok(result.content.includes('Array\\<T\\>'));
    });
  });
});

// =============================================================================
// Transform: h1-demote tests
// =============================================================================

describe('h1-demote transform', () => {
  it('should demote H1 to H2', () => {
    assert.strictEqual(demoteH1('# Title'), '## Title');
  });

  it('should demote all H1s in a document', () => {
    const input = '# First\n\nSome text.\n\n# Second\n\nMore text.';
    const result = demoteH1(input);
    assert.ok(!result.includes('\n# '));
    assert.ok(!result.startsWith('# '));
    assert.ok(result.includes('## First'));
    assert.ok(result.includes('## Second'));
  });

  it('should not modify H2 or deeper headings', () => {
    const input = '## Already H2\n\n### H3';
    assert.strictEqual(demoteH1(input), input);
  });

  it('should not modify H1 inside a fenced code block', () => {
    const input = '```\n# not a heading\n```\n\n# real heading';
    const result = demoteH1(input);
    assert.ok(result.includes('# not a heading'));
    assert.ok(result.includes('## real heading'));
  });

  it('should preserve the H1 title for front matter extraction', () => {
    const converter = new GfmToMdxConverter({ addFrontMatter: true });
    const result = converter.convert('# My Page\n\nContent.');
    assert.ok(result.content.includes('title: My Page'));
    assert.ok(result.content.includes('## My Page'));
    assert.ok(!result.content.match(/^# My Page/m));
  });
});

// =============================================================================
// Transform: html-fix tests
// =============================================================================

describe('html-fix transform', () => {
  it('should make void elements self-closing', () => {
    const result = fixHtml('<br><hr><img src="x">');
    assert.ok(result.includes('<br />'));
    assert.ok(result.includes('<hr />'));
    assert.ok(result.includes('/>'));
  });

  it('should preserve attributes', () => {
    const result = fixHtml('<img src="test.png" alt="test">');
    assert.ok(result.includes('src="test.png"'));
    assert.ok(result.includes('alt="test"'));
  });

  it('should convert class to className', () => {
    const result = fixHtml('<div class="note"><p>text</p></div>');
    assert.ok(result.includes('className='));
    assert.ok(!result.includes(' class='));
  });
});

// =============================================================================
// Transform: admonitions tests
// =============================================================================

describe('admonitions transform', () => {
  it('should convert Note blockquotes', () => {
    const result = convertAdmonitions('> **Note:** Important info');
    assert.ok(result.includes(':::note'));
    assert.ok(result.includes('Important info'));
  });

  it('should convert Warning blockquotes', () => {
    const result = convertAdmonitions('> **Warning:** Be careful');
    assert.ok(result.includes(':::warning'));
  });

  it('should convert emoji-based admonitions', () => {
    const result = convertAdmonitions('> ⚠️ Warning message');
    assert.ok(result.includes(':::warning'));
  });

  it('should leave non-admonition blockquotes unchanged', () => {
    const input = '> Just a regular quote';
    const result = convertAdmonitions(input);
    assert.ok(!result.includes(':::'));
  });

  it('should convert multiple admonitions', () => {
    const input = '> **Note:** First note\n\nSome text\n\n> **Warning:** A warning\n';
    const result = convertAdmonitions(input);
    assert.ok(result.includes(':::note'));
    assert.ok(result.includes(':::warning'));
  });
});

// =============================================================================
// Transform: front-matter tests
// =============================================================================

describe('front-matter transform', () => {
  describe('extractTitle', () => {
    it('should extract H1 title', () => {
      assert.strictEqual(extractTitle('# My Great Title\n\nContent'), 'My Great Title');
    });

    it('should return null if no H1', () => {
      assert.strictEqual(extractTitle('## Not H1\n\nContent'), null);
    });
  });

  describe('stemToTitle', () => {
    it('should capitalize words and replace separators', () => {
      assert.strictEqual(stemToTitle('Sensor-calibration'), 'Sensor Calibration');
    });

    it('should lowercase conjunctions/prepositions', () => {
      assert.strictEqual(stemToTitle('PID-Attenuation-and-scaling'), 'PID Attenuation and Scaling');
    });

    it('should preserve known tokens like iNav', () => {
      assert.strictEqual(stemToTitle('Getting-started-with-iNav'), 'Getting Started with iNav');
    });

    it('should capitalize first word even if it is a preposition', () => {
      assert.strictEqual(stemToTitle('on-screen-display'), 'On Screen Display');
    });
  });

  describe('transform', () => {
    it('should generate YAML front matter with title from stem', () => {
      const result = addFrontMatter('Some content', { stem: 'My-Page' });
      assert.ok(result.startsWith('---'));
      assert.ok(result.includes('title: My Page'));
    });

    it('should quote titles with special characters', () => {
      const result = addFrontMatter('Content', { title: 'Test: A Title' });
      assert.ok(result.includes('"Test: A Title"'));
    });
  });
});

// =============================================================================
// LinkRewriter Tests
// =============================================================================

describe('LinkRewriter', () => {
  // Sample mapping: normalized key → relative docs path
  const sampleMapping = new Map([
    ['failsafe', 'features/Failsafe.md'],
    ['navigation-modes', 'features/Navigation-modes.md'],
    ['navigation-mode-return-to-home', 'features/Navigation-Mode-Return-to-Home.md'],
    ['sensor-calibration', 'quickstart/Sensor-calibration.md'],
    ['gps-and-compass-setup', 'quickstart/GPS--and-Compass-setup.md'],
    ['inav-remote-management-control-and-telemetry', 'advanced/INAV-remote-management-control-and-telemetry.md'],
    ['inavflight-missions', 'features/iNavFlight-Missions.md'],
  ]);

  describe('rewriteWikiUrls', () => {
    it('should rewrite simple GitHub wiki URL', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Failsafe.md');
      const input = '[Failsafe](https://github.com/iNavFlight/inav/wiki/Failsafe)';
      const result = rewriter.rewriteWikiUrls(input);
      assert.ok(result.includes('./Failsafe.md'), `Expected relative link, got: ${result}`);
    });

    it('should rewrite wiki URL with anchor', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Failsafe.md');
      const input = '[Setup](https://github.com/iNavFlight/inav/wiki/GPS-and-Compass-setup#installing-the-gnss-unit---antenna-orientation)';
      const result = rewriter.rewriteWikiUrls(input);
      assert.ok(result.includes('.md#installing'), `Expected anchor preserved, got: ${result}`);
    });

    it('should rewrite wiki URL with colon in page name', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Failsafe.md');
      const input = '[RTH](https://github.com/iNavFlight/inav/wiki/Navigation-Mode:-Return-to-Home)';
      const result = rewriter.rewriteWikiUrls(input);
      assert.ok(result.includes('Navigation-Mode-Return-to-Home.md'), `Expected colon-normalized link, got: ${result}`);
    });

    it('should compute relative path from a different subdirectory', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'quickstart/Sensor-calibration.md');
      const input = '[Failsafe](https://github.com/iNavFlight/inav/wiki/Failsafe)';
      const result = rewriter.rewriteWikiUrls(input);
      assert.ok(result.includes('../features/Failsafe.md'), `Expected cross-directory path, got: ${result}`);
    });

    it('should leave unknown wiki links unchanged', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Failsafe.md');
      const input = '[Unknown](https://github.com/iNavFlight/inav/wiki/NonExistent-Page)';
      const result = rewriter.rewriteWikiUrls(input);
      assert.ok(result.includes('wiki/NonExistent-Page'));
    });

    it('should not modify non-wiki GitHub links', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Failsafe.md');
      const input = '[Setting](https://github.com/iNavFlight/inav/blob/master/docs/Settings.md#failsafe_delay)';
      const result = rewriter.rewriteWikiUrls(input);
      assert.strictEqual(result, input);
    });

    it('should rewrite wiki URL with comma in page name', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Failsafe.md');
      const input = '[INAV Remote](https://github.com/iNavFlight/inav/wiki/INAV-Remote-Management,-Control-and-Telemetry#follow-me-gcs-nav)';
      const result = rewriter.rewriteWikiUrls(input);
      assert.ok(result.includes('INAV-remote-management-control-and-telemetry.md'), `Expected comma-normalized link, got: ${result}`);
      assert.ok(result.includes('#follow-me-gcs-nav'));
    });
  });

  describe('rewriteDoubleLinks', () => {
    it('should rewrite [[PageName]] style links', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Navigation-modes.md');
      const result = rewriter.rewriteDoubleLinks('[[Failsafe]]');
      assert.ok(result.startsWith('[Failsafe]'));
      assert.ok(result.includes('Failsafe.md'));
    });

    it('should rewrite [[display|PageName]] style links', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Navigation-modes.md');
      const result = rewriter.rewriteDoubleLinks('[[wiki missions page|iNavFlight-Missions]]');
      assert.ok(result.startsWith('[wiki missions page]'));
      assert.ok(result.includes('.md'));
    });

    it('should leave unknown [[links]] unchanged', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Navigation-modes.md');
      const input = '[[NonExistent-Page]]';
      assert.strictEqual(rewriter.rewriteDoubleLinks(input), input);
    });
  });

  describe('fixRootRelativeGitHubLinks', () => {
    it('should convert root-relative GitHub paths to full URLs', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Failsafe.md');
      const input = '[releases](/iNavFlight/inav/releases/tag/1.5)';
      const result = rewriter.fixRootRelativeGitHubLinks(input);
      assert.ok(result.includes('https://github.com/iNavFlight/inav/releases/tag/1.5'));
    });
  });

  describe('rewriteAll', () => {
    it('should apply all rewrites', () => {
      const rewriter = new LinkRewriter(sampleMapping, 'features/Failsafe.md');
      const input = 'See [RTH](https://github.com/iNavFlight/inav/wiki/Navigation-Mode:-Return-to-Home) and [[Failsafe]].';
      const result = rewriter.rewriteAll(input);
      assert.ok(result.includes('Navigation-Mode-Return-to-Home.md'));
      assert.ok(result.includes('Failsafe.md'));
    });
  });
});

// =============================================================================
// ImageRewriter Tests
// =============================================================================

describe('ImageRewriter', () => {
  const INAV_RAW_URL = 'https://raw.githubusercontent.com/iNavFlight/inav/master/docs/assets/images/diagram.png';
  const IMGUR_URL = 'https://i.imgur.com/example.png';
  const USER_IMAGES_URL = 'https://user-images.githubusercontent.com/12345/example.png';

  describe('shouldRewrite', () => {
    it('should rewrite iNavFlight raw.githubusercontent.com URLs', () => {
      assert.ok(new ImageRewriter().shouldRewrite(INAV_RAW_URL));
    });

    it('should NOT rewrite imgur URLs', () => {
      assert.ok(!new ImageRewriter().shouldRewrite(IMGUR_URL));
    });

    it('should NOT rewrite user-images.githubusercontent.com', () => {
      assert.ok(!new ImageRewriter().shouldRewrite(USER_IMAGES_URL));
    });
  });

  describe('rewriteAll - markdown images', () => {
    it('should rewrite iNavFlight GitHub image URLs', () => {
      const r = new ImageRewriter();
      const result = r.rewriteAll(`![Diagram](${INAV_RAW_URL})`);
      assert.ok(result.includes('/img/content/diagram.png'));
      assert.ok(!result.includes('githubusercontent.com'));
    });

    it('should leave imgur images unchanged', () => {
      const r = new ImageRewriter();
      const input = `![Image](${IMGUR_URL})`;
      assert.strictEqual(r.rewriteAll(input), input);
    });

    it('should add image to manifest', () => {
      const r = new ImageRewriter();
      r.rewriteAll(`![Diagram](${INAV_RAW_URL})`);
      const manifest = r.getManifest();
      assert.strictEqual(manifest.length, 1);
      assert.strictEqual(manifest[0].url, INAV_RAW_URL);
    });

    it('should handle multiple images in one file', () => {
      const r = new ImageRewriter();
      const result = r.rewriteAll(`![A](${INAV_RAW_URL})\n![B](${IMGUR_URL})`);
      assert.ok(result.includes('/img/content/'));
      assert.ok(result.includes(IMGUR_URL));
      assert.strictEqual(r.getManifest().length, 1);
    });
  });

  describe('rewriteAll - HTML img tags', () => {
    it('should rewrite iNavFlight GitHub URLs in HTML img tags', () => {
      const r = new ImageRewriter();
      const result = r.rewriteAll(`<img src="${INAV_RAW_URL}" alt="diagram" />`);
      assert.ok(result.includes('/img/content/'));
    });
  });

  describe('custom imgBaseUrl', () => {
    it('should use custom base URL', () => {
      const r = new ImageRewriter({ imgBaseUrl: '/static/images' });
      const result = r.rewriteAll(`![Diagram](${INAV_RAW_URL})`);
      assert.ok(result.includes('/static/images/'));
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

For firmware versions < 4.0, see legacy docs.
`;

    const converter = new GfmToMdxConverter({
      addFrontMatter: true,
      convertAdmonitions: true,
    });

    const result = converter.convert(input);

    // Check front matter
    assert.ok(result.content.includes('---'));

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

    // Check "< 4.0" (with space) is NOT escaped
    assert.ok(result.content.includes('< 4.0'));
  });
});
