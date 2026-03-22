# GFM to MDX Converter

Converts GitHub Flavored Markdown to Docusaurus-compatible MDX format.

Designed for migrating wiki-style documentation (like INAV's GitHub wiki) to Docusaurus, handling the "loose" markdown that's common in wikis and converting it to strict MDX.

## Features

- **Lenient parsing** with `markdown-it` - handles real-world markdown that may not be strictly CommonMark compliant
- **Smart escaping** of `<` and `{` characters that MDX would interpret as JSX
- **Code block protection** - never modifies content inside fenced or inline code
- **HTML to JSX fixes** - self-closing void elements, `class` → `className`
- **HTML validation** - warns about unclosed tags and other issues
- **Admonition conversion** - `> **Note:**` → `:::note`
- **Front matter generation** - automatic `sidebar_position`, `title`, `description`
- **Batch processing** - convert entire directories with proper ordering

## Installation

```bash
npm install
```

## Usage

### Single File

```bash
# Output to stdout
node src/cli.js input.md

# Output to file
node src/cli.js input.md output.md

# Preview changes without writing
node src/cli.js input.md --dry-run --verbose
```

### Directory Conversion

```bash
# Convert entire wiki
node src/cli.js --dir ./inav.wiki.git ./docs/version-4.0.0

# Preview first
node src/cli.js --dir ./wiki ./docs --dry-run --verbose
```

### Programmatic API

```javascript
import { GfmToMdxConverter } from 'gfm-to-mdx-converter';

const converter = new GfmToMdxConverter({
  addFrontMatter: true,
  convertAdmonitions: true,
  escapeJsxChars: true,
  fixSelfClosingTags: true,
  validateHtml: true,
});

const result = converter.convert(markdownContent, {
  sidebarPosition: 1,
  sidebarLabel: 'Getting Started',
});

console.log(result.content);   // Converted MDX
console.log(result.warnings);  // Any warnings
console.log(result.changes);   // List of transformations made
```

## Transformations

### Character Escaping

| Pattern | Example | Converted |
|---------|---------|-----------|
| Technical specs | `Air<2g` | `Air\<2g` |
| Generic types | `Array<T>` | `Array\<T\>` |
| Placeholders | `<YOUR_KEY>` | `\<YOUR_KEY\>` |
| Value ranges | `{0-255}` | `\{0-255\}` |
| Comparisons | `version < 5` | `version \< 5` |

### HTML Fixes

| Before | After |
|--------|-------|
| `<br>` | `<br />` |
| `<img src="x">` | `<img src="x" />` |
| `<hr>` | `<hr />` |
| `class="x"` | `className="x"` |

### Admonitions

**Before:**
```markdown
> **Note:** Important information here.
```

**After:**
```markdown
:::note
Important information here.
:::
```

Supports: Note, Warning, Tip, Important, Caution, Danger, and emoji variants (⚠️, ℹ️, 💡)

### Front Matter

Automatically extracts and generates:

```yaml
---
sidebar_position: 1
sidebar_label: Getting Started
title: Getting Started with INAV
description: First paragraph of the document...
---
```

## Options

### CLI Options

| Option | Description |
|--------|-------------|
| `--dir <in> <out>` | Convert directory |
| `--dry-run` | Preview without writing |
| `-v, --verbose` | Show detailed changes |
| `-q, --quiet` | Suppress output |
| `--no-front-matter` | Skip front matter generation |
| `--no-admonitions` | Skip admonition conversion |
| `--no-escape` | Skip character escaping |
| `--no-html-fix` | Skip HTML fixes |
| `--sidebar-start <n>` | Starting sidebar_position |
| `--ext <ext>` | File extension (default: .md) |

### API Options

```javascript
new GfmToMdxConverter({
  addFrontMatter: true,        // Generate front matter
  preserveExistingFrontMatter: true,  // Keep existing front matter
  convertAdmonitions: true,    // Convert blockquote admonitions
  escapeJsxChars: true,        // Escape < and { in prose
  fixSelfClosingTags: true,    // Fix void elements
  validateHtml: true,          // Report HTML issues
  verbose: false,              // Log details
});
```

## Protected Regions

The converter is smart about what NOT to modify:

- **Fenced code blocks** (` ``` `)
- **Inline code** (`` ` ``)
- **Indented code blocks** (4 spaces)

Content inside these regions is never escaped or modified.

## Testing

```bash
npm test
```

## Why markdown-it?

Unlike `remark` which strictly follows CommonMark, `markdown-it` is more lenient and handles "real-world" markdown better - the kind often found in GitHub wikis that may have:

- Inconsistent spacing
- Mixed indentation
- Loose HTML
- Non-standard patterns

This makes it ideal for migration scenarios where the source files weren't written with strict compliance in mind.

## License

MIT
