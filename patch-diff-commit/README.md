# patch-diff-commit — Incremental Wiki→MDX Merger

Applies a wiki PR diff to an already-converted MDX file, without re-running the
full converter.

## Why this exists

After initial conversion, the MDX files accumulate hand-edits: refined front
matter, adjusted cross-links, better admonition wording, etc.  Re-running the
full converter would overwrite those edits.

When a contributor makes a small change to the wiki (a sentence, a parameter
note, a new admonition), this tool applies only that change.  It:

1. Parses the diff into hunks
2. Locates each hunk's region in the MDX using fuzzy matching — accounting for
   the fact that `Air<2g` in GFM is `Air\<2g` in MDX
3. Replays each hunk line-by-line:
   - **context lines** → kept from the MDX (preserving MDX-side edits)
   - **removal lines** → skipped
   - **addition lines** → transformed GFM→MDX and inserted
4. Writes the merged result

## Usage

```bash
# Apply a saved diff
node cli.js wiki/GPS-Configuration.md docs/gps.md changes.diff

# Pipe from git (e.g. a wiki PR)
git diff HEAD~1 -- wiki/GPS-Configuration.md \
  | node cli.js wiki/GPS-Configuration.md docs/gps.md --diff-stdin

# Preview without writing
node cli.js wiki/GPS.md docs/gps.md changes.diff --dry-run --verbose

# Write to a different output file
node cli.js wiki/GPS.md docs/gps.md changes.diff -o docs/gps-merged.md
```

```
ARGUMENTS:
  <gfm-file>    Original GFM wiki source (the file the diff was made against)
  <mdx-file>    Corresponding MDX file to update
  <diff-file>   Unified diff file to apply

OPTIONS:
  --diff-stdin      Read diff from stdin
  -o, --output      Output file (default: overwrites mdx-file, or stdout with --dry-run)
  --dry-run         Preview result without writing
  -v, --verbose     Show hunk-level detail
  -q, --quiet       Suppress non-error output
  --strict          Treat fuzzy matches as conflicts
```

## Programmatic API

```js
import { ThreeWayMerger, mergeGfmToMdx, canApplyDiff } from './index.js';

// Convenience function
const { success, content, appliedHunks, conflicts, warnings } =
  mergeGfmToMdx(gfmString, mdxString, diffString);

// Check applicability without applying
if (canApplyDiff(gfm, mdx, diff)) { /* safe to apply */ }

// Class API — retains state for getSummary()
const merger = new ThreeWayMerger({ verbose: false });
const result  = merger.merge(gfmString, mdxString, diffString);
const summary = merger.getSummary();
// summary: { hunksApplied, hunksConflicted, success, warningsCount, details }
```

## Transformations applied to addition lines

Addition lines go through the same transforms as the full converter
(using the shared `full_file/transforms/` modules):

- `admonitions.js` — `> [!NOTE]` → `:::note`, `> **Warning:**` → `:::warning`
- `escape-jsx.js` — `Air<2g` → `Air\<2g`, `{0-255}` → `\{0-255\}`
- `html-fix.js` — `<br>` → `<br />`, `class=` → `className=`

Code blocks (fenced and inline) are never transformed.

## Matching algorithm

The fuzzy matcher locates each hunk's context lines in the MDX using a
cascade: exact match → normalized match → fuzzy sliding window → anchor-based.

Normalization makes GFM and MDX compare equal:
- `Air<2g` ≡ `Air\<2g` ≡ `Air&lt;2g`
- `{0-255}` ≡ `\{0-255\}`

If no match reaches the confidence threshold, the hunk is recorded as a
**conflict** (not applied) and reported in the output.

## Limitations

- **Works best when MDX was recently converted from the current GFM.**  If the
  MDX and GFM have diverged in line-count within a hunk region (e.g. old manual
  conversion with fewer lines), a removal region may consume the wrong MDX lines.

- **Links and images are not rewritten** in the incremental path.  A one-line
  wiki edit is unlikely to add new cross-page links; if it does, run the full
  converter on that file afterward.

## Module structure

| File | Purpose |
|---|---|
| `cli.js` | Command-line interface |
| `merger.js` | `ThreeWayMerger` — orchestrates the merge |
| `transformer.js` | `GfmToMdxTransformer` — delegates to shared transforms |
| `fuzzy-matcher.js` | `FuzzyMatcher` — locates GFM regions in MDX |
| `diff-parser.js` | `DiffParser` — parses unified diff format |
| `normalizer.js` | `TextNormalizer`, `LineNormalizer` — GFM↔MDX comparison |
| `index.js` | Re-exports all public classes and functions |

## Tests

```bash
node --test merger.test.js
```

46 test cases covering:
- `TextNormalizer` / `LineNormalizer` — entity and escape stripping, similarity scoring
- `DiffParser` — hunk parsing and classification
- `FuzzyMatcher` — exact, normalized, fuzzy, and anchor matching
- `GfmToMdxTransformer` — line and block transforms including admonitions
- `ThreeWayMerger` — prose, code, mixed, empty diff, conflicts, style detection
- Integration with realistic INAV documentation content
- Edge cases: inline code, mixed hunks, completely diverged files
