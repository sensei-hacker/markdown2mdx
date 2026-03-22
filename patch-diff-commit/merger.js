/**
 * Three-Way GFM→MDX Merger
 *
 * Applies a wiki diff (GFM format) to an existing MDX file without re-running
 * the full converter.  Preserves hand-edits in the MDX (front matter, admonitions,
 * manual link fixes, etc.) while incorporating the wiki change.
 *
 * Algorithm per hunk:
 *   1. Find the hunk's anchor region in MDX via fuzzy matching
 *      (handles escaping differences: GFM "Air<2g" ↔ MDX "Air\<2g")
 *   2. Replay hunk.lines in order:
 *      - context lines  → keep the MDX version (preserves MDX-side edits)
 *      - removal lines  → skip (being replaced)
 *      - addition lines → transform GFM→MDX using the shared transforms
 *   3. Splice result back into the MDX line array
 */

import { DiffParser } from './diff-parser.js';
import { FuzzyMatcher } from './fuzzy-matcher.js';
import { GfmToMdxTransformer } from './transformer.js';

// =============================================================================
// ThreeWayMerger
// =============================================================================

export class ThreeWayMerger {
  /**
   * @param {object} options
   * @param {boolean} [options.verbose=false]
   * @param {boolean} [options.allowFuzzyApply=true]
   * @param {number}  [options.minMatchScore=0.7]
   */
  constructor(options = {}) {
    this.options = {
      verbose: false,
      allowFuzzyApply: true,
      minMatchScore: 0.7,
      ...options
    };

    this.diffParser  = new DiffParser();
    this.fuzzyMatcher = new FuzzyMatcher();
    this.transformer  = new GfmToMdxTransformer();
    this._lastResult  = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Merge a wiki diff into an existing MDX file.
   *
   * @param {string} gfmContent   - Original GFM wiki source (the file the diff was made against)
   * @param {string} mdxContent   - Existing MDX file to update
   * @param {string} diffContent  - Unified diff (GFM→GFM, from a wiki PR)
   * @returns {{ success, content, appliedHunks, conflicts, warnings }}
   */
  merge(gfmContent, mdxContent, diffContent) {
    const { hunks } = this.diffParser.parse(diffContent);

    let mdxLines = mdxContent.split('\n');
    const appliedHunks = [];
    const conflicts    = [];
    const warnings     = [];

    for (const hunk of hunks) {
      const result = this._applyHunk(hunk, mdxLines, gfmContent);

      if (result.conflict) {
        if (this.options.verbose) {
          console.warn(`[merger] conflict at hunk @@ -${hunk.oldStart}: ${result.conflict.reason}`);
        }
        conflicts.push(result.conflict);
      } else {
        mdxLines = result.mdxLines;
        appliedHunks.push(hunk);
      }
    }

    const content = mdxLines.join('\n');
    const success = conflicts.length === 0;

    this._lastResult = { success, content, appliedHunks, conflicts, warnings };
    return this._lastResult;
  }

  /**
   * Analyse which escaping conventions the MDX file uses.
   * Used to decide whether to produce backslash or entity escapes.
   *
   * @returns {{ usesBackslashEscape, usesHtmlEntities, usesClassName, usesSelfClosing }}
   */
  analyzeMdxStyle(gfmContent, mdxContent) {
    return {
      usesBackslashEscape: /\\[<>{]/.test(mdxContent),
      usesHtmlEntities:    /&lt;|&gt;|&#\d+;|&#x[0-9a-fA-F]+;/.test(mdxContent),
      usesClassName:       /\bclassName=/.test(mdxContent),
      usesSelfClosing:     /<\w[^>]*\s\/>/.test(mdxContent),
    };
  }

  /**
   * Merge statistics from the most recent merge() call.
   *
   * @returns {{ hunksApplied, hunksConflicted, success, warningsCount, details }}
   */
  getSummary() {
    if (!this._lastResult) {
      return { hunksApplied: 0, hunksConflicted: 0, success: true, warningsCount: 0, details: { applied: [], conflicts: [], warnings: [] } };
    }

    const { appliedHunks, conflicts, warnings, success } = this._lastResult;
    return {
      hunksApplied:    appliedHunks.length,
      hunksConflicted: conflicts.length,
      success,
      warningsCount:   warnings.length,
      details: {
        applied:   appliedHunks,
        conflicts,
        warnings,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: apply a single hunk
  // ---------------------------------------------------------------------------

  _applyHunk(hunk, mdxLines, gfmContent) {
    // Find a useful anchor to locate the hunk in the MDX.
    // Prefer contextBefore (unchanged lines, easier to find);
    // fall back to removals (the content being replaced).
    const hasUsefulContext = hunk.contextBefore.some(l => l.trim() !== '');
    const hasRemovals      = hunk.removals.some(l => l.trim() !== '');

    const searchLines = hasUsefulContext ? hunk.contextBefore
      : hasRemovals                      ? hunk.removals
      : null;

    let hunkStart = hunk.oldStart - 1; // 0-indexed default from GFM line number

    if (searchLines) {
      const currentMdx = mdxLines.join('\n');
      const match = this.fuzzyMatcher.findMatch(searchLines, currentMdx, hunk.oldStart - 1);

      if (!match || match.belowThreshold) {
        return { conflict: { hunk, reason: 'could not locate region in MDX' } };
      }

      // If we searched for contextBefore, the hunk content starts after it.
      // If we searched for removals (no contextBefore), the hunk starts at the match.
      hunkStart = hasUsefulContext
        ? match.startLine  // context starts here; removals follow
        : match.startLine;
    }

    // Clamp to valid range
    hunkStart = Math.max(0, Math.min(hunkStart, mdxLines.length));

    // Classify hunk to decide whether to transform additions
    const hunkType = this.diffParser.classifyHunk(hunk, gfmContent);

    // Replay: walk hunk.lines in order, consuming MDX lines for context/removals.
    // Addition lines are buffered so the admonitions transform sees the full block.
    const newLines = [];
    let mdxPos = hunkStart;
    let inCodeBlock = false;
    let codeMarker  = null;
    let additionBuffer = [];

    const flushAdditions = () => {
      if (additionBuffer.length === 0) return;
      const transformed = (hunkType === 'code' || inCodeBlock)
        ? additionBuffer
        : this.transformer.transformLines(additionBuffer, inCodeBlock);
      newLines.push(...transformed);
      // Update code-block state for lines that were added
      for (const line of additionBuffer) {
        ({ inCodeBlock, codeMarker } = this._codeBlockState(line, inCodeBlock, codeMarker));
      }
      additionBuffer = [];
    };

    for (const lineInfo of hunk.lines) {
      if (lineInfo.type === 'addition') {
        additionBuffer.push(lineInfo.content);
      } else {
        flushAdditions();
        // context or removal: consume the corresponding MDX line
        const mdxLine = mdxPos < mdxLines.length ? mdxLines[mdxPos] : lineInfo.content;
        mdxPos++;

        if (lineInfo.type === 'context') {
          newLines.push(mdxLine); // keep MDX version (may have MDX-side edits)
        }
        // removal: don't push — it's being replaced by the buffered additions

        ({ inCodeBlock, codeMarker } = this._codeBlockState(mdxLine, inCodeBlock, codeMarker));
      }
    }
    flushAdditions();

    // Splice: replace [hunkStart, mdxPos) with the replayed newLines
    const before     = mdxLines.slice(0, hunkStart);
    const after      = mdxLines.slice(mdxPos);
    const newMdxLines = [...before, ...newLines, ...after];

    return { mdxLines: newMdxLines };
  }

  _codeBlockState(line, inCodeBlock, codeMarker) {
    const fence = line.match(/^(`{3,}|~{3,})/);
    if (!fence) return { inCodeBlock, codeMarker };
    if (!inCodeBlock) return { inCodeBlock: true, codeMarker: fence[1][0] };
    if (codeMarker && line.startsWith(codeMarker.repeat(3))) return { inCodeBlock: false, codeMarker: null };
    return { inCodeBlock, codeMarker };
  }
}

// =============================================================================
// Convenience functions
// =============================================================================

/**
 * Merge a wiki diff into an MDX file (functional API).
 *
 * @returns {{ success, content, appliedHunks, conflicts, warnings }}
 */
export function mergeGfmToMdx(gfm, mdx, diff) {
  return new ThreeWayMerger().merge(gfm, mdx, diff);
}

/**
 * Check whether a diff can be applied without conflicts (does not modify files).
 */
export function canApplyDiff(gfm, mdx, diff) {
  return new ThreeWayMerger().merge(gfm, mdx, diff).conflicts.length === 0;
}

export default ThreeWayMerger;
