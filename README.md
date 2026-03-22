# markdown2mdx

Converts INAV wiki Markdown (GitHub Flavored Markdown) to Docusaurus-compatible MDX.

Two tools live here, used at different points in the workflow:

| Tool | Use when |
|---|---|
| [`full_file/`](#full-converter) | Initial conversion, versioned docs, re-generating a whole file |
| [`patch-diff-commit/`](#incremental-merger) | Applying a wiki PR to an already-converted MDX without overwriting hand-edits |

---

## Full Converter

**`full_file/`** — converts an entire GFM file to MDX in one pass.

### Usage

```bash
# Single file → stdout
node full_file/cli.js wiki/GPS-Configuration.md

# Single file → file
node full_file/cli.js wiki/GPS-Configuration.md docs/gps.md

# Whole directory
node full_file/cli.js --dir ./inavwiki ./iNavFlight.github.io/docs

# Preview without writing
node full_file/cli.js --dir ./inavwiki ./docs --dry-run --verbose
```

See `node full_file/cli.js --help` for all options.

### What it converts

| Pattern | Input | Output |
|---|---|---|
| Technical specs | `Air<2g` | `Air\<2g` |
| Generic types | `Array<T>` | `Array\<T\>` |
| Placeholders | `<YOUR_KEY>` | `\<YOUR_KEY\>` |
| Value ranges | `{0-255}` | `\{0-255\}` |
| Void elements | `<br>` | `<br />` |
| Attributes | `class="x"` | `className="x"` |
| Admonitions | `> [!NOTE]` / `> **Note:**` | `:::note` |
| Front matter | (generated) | `sidebar_position`, `title` |

Code blocks (fenced and inline) are never modified.

### Programmatic API

```js
import { GfmToMdxConverter } from './full_file/converter.js';

const converter = new GfmToMdxConverter();
const { content } = converter.convert(markdownString, { sidebarPosition: 3 });
```

### Tests

```bash
node --test full_file/converter.test.js
```

642 test cases covering all transforms.

---

## Incremental Merger

**`patch-diff-commit/`** — applies a wiki PR diff to an existing MDX file.

### Why this exists

After the initial conversion, the MDX files may accumulate hand-edits: better
front matter, adjusted links, admonition rewrites, etc.  If a contributor makes
a one-line change to the wiki, re-running the full converter would overwrite
those edits.

The merger applies only the diff's changes.  It uses fuzzy matching to locate
the right region in MDX even though the text differs from GFM (e.g. `Air\<2g`
in MDX vs `Air<2g` in GFM).  Context lines from the MDX are kept as-is;
only the addition lines are transformed and spliced in.

### Usage

```bash
# Apply a saved diff file
node patch-diff-commit/cli.js wiki/GPS.md docs/gps.md changes.diff

# Pipe directly from git (wiki PR diff)
git diff HEAD~1 -- wiki/GPS-Configuration.md \
  | node patch-diff-commit/cli.js wiki/GPS-Configuration.md docs/gps.md --diff-stdin

# Preview without writing
node patch-diff-commit/cli.js wiki/GPS.md docs/gps.md changes.diff --dry-run --verbose

# Write merged result to a different file
node patch-diff-commit/cli.js wiki/GPS.md docs/gps.md changes.diff -o docs/gps-merged.md
```

See `node patch-diff-commit/cli.js --help` for all options.

### Programmatic API

```js
import { ThreeWayMerger, mergeGfmToMdx, canApplyDiff } from './patch-diff-commit/index.js';

// Functional convenience
const result = mergeGfmToMdx(gfmContent, mdxContent, diffContent);
console.log(result.success);        // true if no conflicts
console.log(result.content);        // merged MDX string
console.log(result.appliedHunks);   // hunks that were applied
console.log(result.conflicts);      // hunks that could not be located

// Check applicability without modifying
if (canApplyDiff(gfm, mdx, diff)) { /* safe to apply */ }

// Class API with options
const merger = new ThreeWayMerger({ verbose: true });
const result = merger.merge(gfmContent, mdxContent, diffContent);
const summary = merger.getSummary();
```

### Tests

```bash
node --test patch-diff-commit/merger.test.js
```

46 test cases covering the normalizer, diff parser, fuzzy matcher, transformer,
merger, integration with INAV-style content, and edge cases.

---

## Versioned Docs Script

**`make-versioned-docs.sh`** — generates a complete Docusaurus versioned-docs
snapshot from a specific point in the wiki git history.

```bash
./make-versioned-docs.sh <version> <wiki-commit> <docs-site-dir> [output-dir]

# Example: generate 7.1.2 docs from wiki commit c0e9dd6
./make-versioned-docs.sh 7.1.2 c0e9dd6 ../iNavFlight.github.io
```

This creates:
- `versioned_docs/version-<version>/` — converted MDX files in category subdirs
- `versioned_sidebars/version-<version>-sidebars.json`

After running, add the version to `versions.json` in the docs site and rebuild.

---

## Running All Tests

```bash
node --test full_file/converter.test.js
node --test patch-diff-commit/merger.test.js
```
