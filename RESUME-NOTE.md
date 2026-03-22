# Resume Note - markdown2mdx audit iteration

## What was just done

Restructured converter into individual transform files under `full_file/transforms/`:
- `trailing-whitespace.js` - strips trailing whitespace
- `heading-normalize.js` - currently a no-op (manual did NOT promote headings)
- `admonitions.js` - converts blockquote admonitions, HR-wrapped callouts, intro **Important:**
- `front-matter.js` - generates YAML front matter, title from STEM first
- `links.js` - thin wrapper around link-rewriter.js
- `images.js` - thin wrapper around image-rewriter.js
- `html-fix.js` - JSX HTML fixes
- `escape-jsx.js` - escapes < { characters

`converter.js` is now a thin orchestrator importing from these modules.

Added fixes:
- `--link-base <dir>` CLI option (fix for relative link path computation)
- Reversed link `(text)[url]` → `[text](url)` fix
- Final newline ensured
- Front matter title uses STEM first (not H1) to match manual convention
- Admonitions: removed overbroad bold-keyword paragraph conversion

## What was about to happen next

Run the audit comparison with correct directory structure:

```bash
TMPDIR=/home/raymorris/Documents/planes/inavflight/tmp/tmp.EJrM5wVjm6
DOCS=/home/raymorris/Documents/planes/inavflight/iNavFlight.github.io/docs
CONV=/home/raymorris/Documents/planes/inavflight/markdown2mdx
OUT=/home/raymorris/Documents/planes/inavflight/tmp/audit-out3

mkdir -p "$OUT/quickstart" "$OUT/features" "$OUT/advanced"

declare -A CATS=(
  [Failsafe]="features"
  [Navigation-modes]="features"
  [iNav-CLI-variables]="advanced"
  [Sensor-calibration]="quickstart"
  [Getting-started-with-iNav]="quickstart"
  [PID-Attenuation-and-scaling]="advanced"
)

for f in "${!CATS[@]}"; do
  cat="${CATS[$f]}"
  node "$CONV/full_file/cli.js" \
    --minimal-front-matter \
    --rewrite-links --docs-dir "$DOCS" --link-base "$OUT" \
    --rewrite-images \
    "$TMPDIR/${f}.md" "$OUT/$cat/${f}.md"
done
```

Then diff each output against the manual:
```bash
declare -A MANUAL=(
  [Failsafe]="$DOCS/features/Failsafe.md"
  [Navigation-modes]="$DOCS/features/Navigation-modes.md"
  [iNav-CLI-variables]="$DOCS/advanced/iNav-CLI-variables.md"
  [Sensor-calibration]="$DOCS/quickstart/Sensor-calibration.md"
  [Getting-started-with-iNav]="$DOCS/quickstart/Getting-started-with-iNav.md"
  [PID-Attenuation-and-scaling]="$DOCS/advanced/PID-Attenuation-and-scaling.md"
)

for f in "${!MANUAL[@]}"; do
  cat="${CATS[$f]}"
  echo "=== $f ===" && diff "${MANUAL[$f]}" "$OUT/$cat/${f}.md"
done
```

Then analyze remaining diffs and iterate until output matches manual.

## Known remaining issues from last diff run

1. **Link paths still wrong** - was using wrong `--link-base` (pointing to docs/ but
   output was in /tmp/audit-out2/ so path.relative gave bizarre ../../inavflight/... paths).
   Fixed by: using `--link-base "$OUT"` and outputting to `$OUT/$cat/$file.md`
   so that relOutputPath correctly = "features/Failsafe.md" etc.

2. **Title for Getting-started** - manual has "Getting Started" but stem gives
   "Getting Started With I Nav" due to iNav. Need to check stemToTitle behavior.

3. **:::note injected mid-content** - previous version of admonitions.js was
   converting **Note:** paragraphs in middle of content. Fixed in latest admonitions.js
   (only intro **Important:** converted now).

4. **Sensor-calibration title** - was "Accelerometer calibration steps" (from promoted H1).
   Fixed: heading-normalize is now no-op, title from stem = "Sensor Calibration" ✓

5. **PID alt text** - manual added alt text not in source. Editorial, NOT automating.

6. **Trailing spaces** - some manual lines have trailing spaces (inconsistency in manual).
   Converter strips them all (more consistent = acceptable per task spec).

7. **iNav-CLI-variables** - manual wraps first line as :::note. Need to check if
   this is the intro **Important:** pattern or something else. Wiki source starts with
   plain text "iNAV CLI variables related to navigation features" (no bold keyword).
   This may be editorial in the manual.

## Wiki commit used for audit

Commit: `23d7562` (from inavwiki, circa 2023-08-01, INAV 6.1 era)
Extracted to: `/home/raymorris/Documents/planes/inavflight/tmp/tmp.EJrM5wVjm6/`

## File structure of transforms/

Each file exports `transform(content, ctx?) => string`

The consistent interface is intentional - allows pipeline composition,
testing each transform in isolation, and easy addition of new transforms.

## After audit iteration is done

- Regenerate versioned_docs/version-7.1.2/ and version-8.0.1/ with updated converter
- Run Docusaurus build to verify
- Send completion report to manager
