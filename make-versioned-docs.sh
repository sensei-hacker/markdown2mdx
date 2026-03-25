#!/usr/bin/env bash
# make-versioned-docs.sh
#
# Generate versioned Docusaurus docs from the iNavFlight wiki git history.
#
# Usage:
#   ./make-versioned-docs.sh <version> <wiki-commit> <docs-site-dir> <output-dir>
#
# Example:
#   ./make-versioned-docs.sh 7.1.2 3964403 ../iNavFlight.github.io ../iNavFlight.github.io
#
# This will:
#   1. Extract wiki files at <wiki-commit> to a temp directory
#   2. Run the converter on each file
#   3. Categorize output into quickstart/features/advanced/legacyinfo
#   4. Write to versioned_docs/version-<version>/ in <docs-site-dir>
#   5. Write versioned_sidebars/version-<version>-sidebars.json
#   6. Print instruction to update versions.json

set -e

VERSION="${1?Usage: $0 <version> <wiki-commit> <docs-site-dir> <output-parent>}"
WIKI_COMMIT="${2?Missing wiki commit}"
DOCS_DIR="${3?Missing docs-site-dir}"
OUTPUT_PARENT="${4:-$DOCS_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIKI_DIR="$(cd "$SCRIPT_DIR/../inavwiki" && pwd)"
DOCS_SITE_DIR="$(cd "$DOCS_DIR" && pwd)"

# Major version number (e.g. "7" from "7.1.2") — used to filter release notes
MAJOR_VERSION="${VERSION%%.*}"

VERSION_DIR="$OUTPUT_PARENT/versioned_docs/version-$VERSION"
SIDEBAR_FILE="$OUTPUT_PARENT/versioned_sidebars/version-${VERSION}-sidebars.json"

echo "=== Generating versioned docs for INAV $VERSION ==="
echo "    Wiki commit: $WIKI_COMMIT"
echo "    Output: $VERSION_DIR"
echo ""

# Step 1: Extract wiki at specified commit to temp dir
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "Extracting wiki at commit $WIKI_COMMIT..."
cd "$WIKI_DIR"
git archive "$WIKI_COMMIT" | tar -x -C "$TMPDIR"
echo "  $(ls "$TMPDIR"/*.md 2>/dev/null | wc -l) markdown files extracted"

# Step 2: Build category mapping from current docs site
# Map: normalized-page-name → category (quickstart/features/advanced/legacyinfo)
# Keys are normalized (lowercase, colons→dashes, consecutive dashes collapsed) so
# wiki filenames like "GPS-and-Compass-setup" match docs entries like "GPS--and-Compass-setup".
declare -A CATEGORY_MAP
while IFS='|' read -r name dir; do
  CATEGORY_MAP["$name"]="$dir"
done < <(
  find "$DOCS_SITE_DIR/docs" -name "*.md" | while read f; do
    rel="${f#$DOCS_SITE_DIR/docs/}"
    dir="${rel%/*}"
    base="${rel##*/}"
    stem="${base%.md}"
    # Get directory part only
    if [[ "$dir" == "$base" ]]; then dir="advanced"; fi
    # Normalize key: lowercase, colons→dashes, collapse consecutive dashes
    norm="${stem,,}"
    norm="${norm//:/-}"
    norm="${norm//--/-}"
    echo "${norm}|${dir}"
  done
)

# Step 3: Convert and categorize each wiki file
echo "Converting and categorizing files..."
mkdir -p "$VERSION_DIR"/{quickstart,features,advanced,legacyinfo}

converter_args=(
  "--minimal-front-matter"
  "--rewrite-links" "--docs-dir" "$DOCS_SITE_DIR/docs" "--link-base" "$VERSION_DIR"
  "--rewrite-images"
)

converted=0
skipped=0
release_note_files=()   # GFM paths of major-version release notes, combined later

for wiki_file in "$TMPDIR"/*.md; do
  stem="$(basename "$wiki_file" .md)"

  # Skip sidebar and home files
  if [[ "$stem" =~ ^(_Sidebar|Home|_Footer|_Header)$ ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  # Sanitize stem: remove characters that break Docusaurus routing, HTML class
  # attributes, or markdown link syntax.
  # The wiki file '"Something"-is-disabled----Reasons.md' is a real example.
  # Parentheses break markdown link syntax: [text](page-(paren).md) is mis-parsed.
  safe_stem="${stem//\"/}"        # remove double quotes
  safe_stem="${safe_stem//\</}"   # remove <
  safe_stem="${safe_stem//\>/}"   # remove >
  safe_stem="${safe_stem//\`/}"   # remove backticks
  safe_stem="${safe_stem//|/}"    # remove pipes
  safe_stem="${safe_stem//\(/-}"  # ( → - (consistent with link normalizer)
  safe_stem="${safe_stem//\)/}"   # ) → removed
  safe_stem="${safe_stem//--/-}"  # collapse any resulting consecutive dashes
  safe_stem="${safe_stem%%-}"     # strip trailing dash
  stem="$safe_stem"

  # Determine category from mapping (keys are normalized), default to advanced
  normalized="${stem,,}"
  normalized="${normalized//:/-}"
  normalized="${normalized//--/-}"
  category="${CATEGORY_MAP[$normalized]:-advanced}"

  # Handle root-level special files
  if [[ "$stem" =~ ^(welcome|Welcome)$ ]]; then
    out_file="$VERSION_DIR/welcome.md"
  elif [[ "$stem" =~ ^[0-9]+\.[0-9]+.*[Rr]elease.*$ ]]; then
    # Collect major-version release notes for the combined tabbed page.
    # Skip other versions entirely.
    stem_major="${stem%%.*}"
    if [[ "$stem_major" != "$MAJOR_VERSION" ]]; then
      skipped=$((skipped + 1))
      continue
    fi
    release_note_files+=("$wiki_file")
    skipped=$((skipped + 1))  # not converted individually
    continue
  else
    out_file="$VERSION_DIR/$category/$stem.md"
  fi

  # Run converter
  node "$SCRIPT_DIR/full_file/cli.js" "${converter_args[@]}" "$wiki_file" "$out_file" 2>/dev/null
  converted=$((converted + 1))
done

echo "  Converted: $converted files"
echo "  Skipped: $skipped files (sidebars, home, etc.)"

# Step 4: Combine release notes into a single tabbed MDX page
if [ ${#release_note_files[@]} -gt 0 ]; then
  release_notes_out="$VERSION_DIR/Release-Notes.md"
  node "$SCRIPT_DIR/full_file/combine-release-notes.js" \
    --major "$MAJOR_VERSION" \
    --output "$release_notes_out" \
    --static-dir "$DOCS_SITE_DIR/static" \
    "${release_note_files[@]}"
  echo "  Combined ${#release_note_files[@]} release note(s) → $release_notes_out"
fi

# Step 6: Write versioned sidebar
cat > "$SIDEBAR_FILE" <<'EOF'
{
  "documentationSidebar": [
    {
      "type": "autogenerated",
      "dirName": "."
    }
  ]
}
EOF
echo "  Wrote: $SIDEBAR_FILE"

# Step 7: Generate _category_.json files
for cat_dir in quickstart features advanced legacyinfo; do
  cat_path="$VERSION_DIR/$cat_dir"
  if [ -d "$cat_path" ] && [ "$(ls -A "$cat_path")" ]; then
    label="${cat_dir^}"  # capitalize first letter
    # Position based on order
    case "$cat_dir" in
      quickstart) pos=1 ;;
      features)   pos=2 ;;
      advanced)   pos=3 ;;
      legacyinfo) pos=4 ;;
    esac
    cat > "$cat_path/_category_.json" <<EOF
{
  "label": "$label",
  "position": $pos
}
EOF
  fi
done

# Step 8: Re-resolve relative links using the versioned output as the mapping source.
# Pass 1 resolved links using docs/ (which may have different filenames due to colons/commas
# in wiki filenames). This pass corrects those using the actual output file layout.
echo "Re-resolving relative links using versioned output mapping..."
node "$SCRIPT_DIR/full_file/cli.js" \
  --dir "$VERSION_DIR" "$VERSION_DIR" \
  --rewrite-links --docs-dir "$VERSION_DIR" --link-base "$VERSION_DIR" \
  --no-admonitions --no-escape --no-html-fix --quiet
echo "  Done."

echo ""
echo "=== Done! ==="
echo ""
echo "Next steps:"
echo "  1. Update $OUTPUT_PARENT/versions.json to add \"$VERSION\""
echo "  2. Run 'cd $DOCS_SITE_DIR && npm run build' to verify the site builds"
echo ""
echo "To add to versions.json, edit it to include \"$VERSION\" in the list."
