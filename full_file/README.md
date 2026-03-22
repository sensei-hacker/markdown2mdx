# full_file — GFM to MDX Converter

Converts GitHub Flavored Markdown to Docusaurus-compatible MDX format.

Designed for migrating wiki-style documentation (e.g. INAV's GitHub wiki) to
Docusaurus, handling the "loose" markdown common in wikis and converting it to
strict MDX.

## Usage

### CLI

```bash
# Single file → stdout
node cli.js input.md

# Single file → file
node cli.js input.md output.md

# Entire directory
node cli.js --dir ./wiki ./docs

# Preview without writing
node cli.js input.md --dry-run --verbose
```

```
OPTIONS:
  --dir <in> <out>      Convert all .md files in a directory
  --dry-run             Preview changes without writing
  -v, --verbose         Show detailed output
  -q, --quiet           Suppress non-error output
  --no-front-matter     Don't add Docusaurus front matter
  --no-admonitions      Don't convert blockquotes to admonitions
  --no-escape           Don't escape < and { characters
  --no-html-fix         Don't fix HTML for JSX compatibility
  --sidebar-start <n>   Starting sidebar_position (default: 1)
  --link-base <dir>     Base directory for resolving relative links
  --ext <ext>           File extension to process (default: .md)
```

### Programmatic API

```js
import { GfmToMdxConverter } from './converter.js';

const converter = new GfmToMdxConverter({
  addFrontMatter: true,      // Generate sidebar_position/title (default: true)
  convertAdmonitions: true,  // Convert > [!NOTE] etc. (default: true)
  escapeJsxChars: true,      // Escape < and { in prose (default: true)
  fixHtml: true,             // Fix void elements, class→className (default: true)
});

const { content } = converter.convert(markdownString, {
  sidebarPosition: 3,
  sidebarLabel: 'GPS Setup',
});
// content is the converted MDX string
```

## Transformations

### Character Escaping

| Pattern | Example | MDX output |
|---|---|---|
| Technical specs | `Air<2g` | `Air\<2g` |
| Generic types | `Array<T>` | `Array\<T\>` |
| Placeholders | `<YOUR_KEY>` | `\<YOUR_KEY\>` |
| Value ranges | `{0-255}` | `\{0-255\}` |
| Comparisons | `<4.0` (no space) | `\<4.0` |

`< ` with a trailing space (e.g. `speed < 3 m/s`) is left as-is — safe in MDX.

### HTML Fixes

| Before | After |
|---|---|
| `<br>` | `<br />` |
| `<img src="x">` | `<img src="x" />` |
| `class="x"` | `className="x"` |
| `<body>` inside table | `<tbody>` |

### Admonitions

```markdown
> [!NOTE]              →   :::note
> [!WARNING]           →   :::warning
> **Note:** text       →   :::note
> ⚠️ text              →   :::warning
---
Warning: text          →   :::warning
---
```

### Front Matter

Generated from the file stem and first paragraph:

```yaml
---
sidebar_position: 1
sidebar_label: GPS Configuration
title: GPS Configuration
---
```

## Architecture

The converter is a thin orchestrator (`converter.js`) over independent
transform files in `transforms/`.  Each transform exports:

```js
transform(content, ctx?) => string
```

| Transform file | What it does |
|---|---|
| `admonitions.js` | Converts blockquote/HR-wrapped admonitions |
| `h1-demote.js` | Demotes `# H1` to `## H2` (Docusaurus renders the front-matter title as H1) |
| `html-fix.js` | Fixes void elements, class→className, table body |
| `escape-jsx.js` | Escapes `<` and `{` in prose (O(n) scan) |
| `horizontal-rules.js` | Converts `____` runs to `---` |
| `reversed-links.js` | Fixes `(text)[url]` → `[text](url)` |
| `links.js` | Rewrites wiki-relative links to docs-relative paths |
| `images.js` | Rewrites GitHub image URLs to local `/img/content/` paths |
| `trailing-whitespace.js` | Strips trailing spaces |
| `front-matter.js` | Generates/preserves YAML front matter |

Protected regions (fenced code blocks, inline code) are never modified by any transform.

## Tests

```bash
node --test converter.test.js
```

642 test cases covering all transforms individually plus integration scenarios.
