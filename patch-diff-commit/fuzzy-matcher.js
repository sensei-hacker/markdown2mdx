/**
 * Fuzzy Matcher
 * 
 * Finds corresponding regions between GFM and MDX files,
 * accounting for transformation differences.
 */

import { LineNormalizer } from './normalizer.js';

// =============================================================================
// Match Result Types
// =============================================================================

/**
 * @typedef {Object} MatchResult
 * @property {number} startLine - Starting line in target (0-indexed)
 * @property {number} endLine - Ending line in target (0-indexed, exclusive)
 * @property {number} score - Match confidence (0-1)
 * @property {string} method - How the match was found
 * @property {Object[]} lineMatches - Per-line match details
 */

// =============================================================================
// Fuzzy Matcher Class
// =============================================================================

export class FuzzyMatcher {
  constructor(options = {}) {
    this.options = {
      minLineScore: 0.6,      // Minimum score for a line to be considered matching
      minBlockScore: 0.7,     // Minimum average score for a block match
      contextWeight: 0.3,     // Weight given to context matching
      contentWeight: 0.7,     // Weight given to content matching
      maxSearchWindow: 50,    // Max lines to search before/after expected position
      ...options
    };

    this.normalizer = new LineNormalizer();
  }

  /**
   * Find the corresponding region in MDX for GFM lines
   * 
   * @param {string[]} gfmLines - Lines from GFM file to find
   * @param {string} mdxContent - Full MDX file content
   * @param {number} expectedLine - Expected line number (hint from diff)
   * @returns {MatchResult|null}
   */
  findMatch(gfmLines, mdxContent, expectedLine = 0) {
    const mdxLines = mdxContent.split('\n');
    
    if (gfmLines.length === 0) {
      return null;
    }

    // Try exact match first (fastest)
    const exactMatch = this.tryExactMatch(gfmLines, mdxLines, expectedLine);
    if (exactMatch && exactMatch.score > 0.95) {
      return exactMatch;
    }

    // Try normalized match
    const normalizedMatch = this.tryNormalizedMatch(gfmLines, mdxLines, expectedLine);
    if (normalizedMatch && normalizedMatch.score >= this.options.minBlockScore) {
      return normalizedMatch;
    }

    // Try fuzzy sliding window match
    const fuzzyMatch = this.tryFuzzyMatch(gfmLines, mdxLines, expectedLine);
    if (fuzzyMatch && fuzzyMatch.score >= this.options.minBlockScore) {
      return fuzzyMatch;
    }

    // Try anchor-based matching (find unique lines as anchors)
    const anchorMatch = this.tryAnchorMatch(gfmLines, mdxLines);
    if (anchorMatch && anchorMatch.score >= this.options.minBlockScore) {
      return anchorMatch;
    }

    // Return best match found, even if below threshold (with warning)
    const bestMatch = [exactMatch, normalizedMatch, fuzzyMatch, anchorMatch]
      .filter(m => m !== null)
      .sort((a, b) => b.score - a.score)[0];

    if (bestMatch) {
      bestMatch.belowThreshold = bestMatch.score < this.options.minBlockScore;
    }

    return bestMatch || null;
  }

  /**
   * Try to find an exact match (no normalization)
   */
  tryExactMatch(gfmLines, mdxLines, expectedLine) {
    const searchStart = Math.max(0, expectedLine - this.options.maxSearchWindow);
    const searchEnd = Math.min(mdxLines.length, expectedLine + this.options.maxSearchWindow);

    for (let i = searchStart; i <= searchEnd - gfmLines.length; i++) {
      let allMatch = true;
      for (let j = 0; j < gfmLines.length; j++) {
        if (gfmLines[j] !== mdxLines[i + j]) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        return {
          startLine: i,
          endLine: i + gfmLines.length,
          score: 1.0,
          method: 'exact',
          lineMatches: gfmLines.map((line, idx) => ({
            gfmLine: line,
            mdxLine: mdxLines[i + idx],
            score: 1.0
          }))
        };
      }
    }

    return null;
  }

  /**
   * Try to find a match using normalized comparison
   */
  tryNormalizedMatch(gfmLines, mdxLines, expectedLine) {
    const normGfmLines = gfmLines.map(l => this.normalizer.normalize(l));
    const normMdxLines = mdxLines.map(l => this.normalizer.normalize(l));

    const searchStart = Math.max(0, expectedLine - this.options.maxSearchWindow);
    const searchEnd = Math.min(mdxLines.length, expectedLine + this.options.maxSearchWindow);

    for (let i = searchStart; i <= searchEnd - gfmLines.length; i++) {
      let allMatch = true;
      const lineMatches = [];

      for (let j = 0; j < gfmLines.length; j++) {
        const match = normGfmLines[j] === normMdxLines[i + j];
        lineMatches.push({
          gfmLine: gfmLines[j],
          mdxLine: mdxLines[i + j],
          score: match ? 1.0 : 0.0
        });
        if (!match) {
          allMatch = false;
        }
      }

      if (allMatch) {
        return {
          startLine: i,
          endLine: i + gfmLines.length,
          score: 1.0,
          method: 'normalized',
          lineMatches
        };
      }
    }

    return null;
  }

  /**
   * Try fuzzy matching with sliding window
   */
  tryFuzzyMatch(gfmLines, mdxLines, expectedLine) {
    const searchStart = Math.max(0, expectedLine - this.options.maxSearchWindow);
    const searchEnd = Math.min(mdxLines.length, expectedLine + this.options.maxSearchWindow);

    let bestMatch = null;
    let bestScore = 0;

    // Try different window sizes (allow some line count variation)
    const minSize = Math.max(1, gfmLines.length - 2);
    const maxSize = gfmLines.length + 2;

    for (let windowSize = minSize; windowSize <= maxSize; windowSize++) {
      for (let i = searchStart; i <= searchEnd - windowSize; i++) {
        const { score, lineMatches } = this.scoreWindowMatch(
          gfmLines, 
          mdxLines.slice(i, i + windowSize),
          i
        );

        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            startLine: i,
            endLine: i + windowSize,
            score,
            method: 'fuzzy',
            lineMatches
          };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Score how well a window of MDX lines matches GFM lines
   */
  scoreWindowMatch(gfmLines, mdxWindow, startIdx) {
    const lineMatches = [];
    let totalScore = 0;

    // Use dynamic programming to find best line alignment
    // (handles inserted/deleted lines between versions)
    const alignment = this.alignLines(gfmLines, mdxWindow);

    for (const { gfmIdx, mdxIdx, score } of alignment) {
      lineMatches.push({
        gfmLine: gfmIdx >= 0 ? gfmLines[gfmIdx] : null,
        mdxLine: mdxIdx >= 0 ? mdxWindow[mdxIdx] : null,
        gfmIdx,
        mdxIdx: mdxIdx >= 0 ? startIdx + mdxIdx : -1,
        score
      });
      totalScore += score;
    }

    const avgScore = alignment.length > 0 ? totalScore / Math.max(gfmLines.length, mdxWindow.length) : 0;

    return { score: avgScore, lineMatches };
  }

  /**
   * Align two sets of lines using dynamic programming
   * Returns best matching pairs
   */
  alignLines(lines1, lines2) {
    const m = lines1.length;
    const n = lines2.length;

    // Compute similarity matrix
    const sim = [];
    for (let i = 0; i < m; i++) {
      sim[i] = [];
      for (let j = 0; j < n; j++) {
        sim[i][j] = this.normalizer.compare(lines1[i], lines2[j]);
      }
    }

    // DP to find best alignment
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    const path = Array(m + 1).fill(null).map(() => Array(n + 1).fill(null));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const matchScore = dp[i-1][j-1] + sim[i-1][j-1];
        const skipGfm = dp[i-1][j] - 0.1;  // Penalty for skipping
        const skipMdx = dp[i][j-1] - 0.1;

        if (matchScore >= skipGfm && matchScore >= skipMdx) {
          dp[i][j] = matchScore;
          path[i][j] = 'match';
        } else if (skipGfm >= skipMdx) {
          dp[i][j] = skipGfm;
          path[i][j] = 'skip_gfm';
        } else {
          dp[i][j] = skipMdx;
          path[i][j] = 'skip_mdx';
        }
      }
    }

    // Backtrack to get alignment
    const alignment = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && path[i][j] === 'match') {
        alignment.unshift({ gfmIdx: i-1, mdxIdx: j-1, score: sim[i-1][j-1] });
        i--; j--;
      } else if (i > 0 && (j === 0 || path[i][j] === 'skip_gfm')) {
        alignment.unshift({ gfmIdx: i-1, mdxIdx: -1, score: 0 });
        i--;
      } else {
        alignment.unshift({ gfmIdx: -1, mdxIdx: j-1, score: 0 });
        j--;
      }
    }

    return alignment;
  }

  /**
   * Try anchor-based matching (find unique distinctive lines)
   */
  tryAnchorMatch(gfmLines, mdxLines) {
    // Find distinctive lines in GFM (likely unique identifiers)
    const anchors = this.findAnchors(gfmLines, mdxLines);
    
    if (anchors.length === 0) {
      return null;
    }

    // Use anchors to estimate region
    const mdxPositions = anchors.map(a => a.mdxLine);
    const minPos = Math.min(...mdxPositions);
    const maxPos = Math.max(...mdxPositions);

    // Expand to cover expected range
    const expectedRange = gfmLines.length;
    const startLine = Math.max(0, minPos - Math.floor(expectedRange * 0.2));
    const endLine = Math.min(mdxLines.length, maxPos + Math.ceil(expectedRange * 0.2));

    // Score this region
    const { score, lineMatches } = this.scoreWindowMatch(
      gfmLines,
      mdxLines.slice(startLine, endLine),
      startLine
    );

    return {
      startLine,
      endLine,
      score,
      method: 'anchor',
      anchors,
      lineMatches
    };
  }

  /**
   * Find anchor lines (distinctive lines that appear in both)
   */
  findAnchors(gfmLines, mdxLines) {
    const anchors = [];
    const normMdxLines = mdxLines.map(l => this.normalizer.normalize(l));

    for (let i = 0; i < gfmLines.length; i++) {
      const gfmLine = gfmLines[i];
      const normGfm = this.normalizer.normalize(gfmLine);

      // Skip short/common lines
      if (normGfm.length < 20) continue;
      if (this.isCommonLine(normGfm)) continue;

      // Find in MDX
      for (let j = 0; j < normMdxLines.length; j++) {
        if (this.normalizer.compare(normGfm, normMdxLines[j]) > 0.9) {
          anchors.push({
            gfmLine: i,
            mdxLine: j,
            content: gfmLine,
            score: this.normalizer.compare(normGfm, normMdxLines[j])
          });
          break;  // Take first match
        }
      }
    }

    return anchors;
  }

  /**
   * Check if a line is too common to be a useful anchor
   */
  isCommonLine(line) {
    const commonPatterns = [
      /^#+\s*$/, // Empty headings
      /^\s*$/, // Blank lines
      /^[-*]\s*$/, // Empty list items
      /^```\s*\w*$/, // Code fence markers
      /^\|[-:\s|]+\|$/, // Table separators
    ];
    return commonPatterns.some(p => p.test(line));
  }

  /**
   * Find match with extended context for better accuracy
   */
  findMatchWithContext(gfmLines, mdxContent, contextBefore, contextAfter, expectedLine = 0) {
    // First find match for main content
    const mainMatch = this.findMatch(gfmLines, mdxContent, expectedLine);
    
    if (!mainMatch) {
      return null;
    }

    // Verify with context
    const mdxLines = mdxContent.split('\n');
    let contextScore = 0;
    let contextChecks = 0;

    // Check context before
    if (contextBefore.length > 0 && mainMatch.startLine > 0) {
      const mdxContextBefore = mdxLines.slice(
        Math.max(0, mainMatch.startLine - contextBefore.length),
        mainMatch.startLine
      );
      for (let i = 0; i < Math.min(contextBefore.length, mdxContextBefore.length); i++) {
        contextScore += this.normalizer.compare(
          contextBefore[contextBefore.length - 1 - i],
          mdxContextBefore[mdxContextBefore.length - 1 - i]
        );
        contextChecks++;
      }
    }

    // Check context after
    if (contextAfter.length > 0 && mainMatch.endLine < mdxLines.length) {
      const mdxContextAfter = mdxLines.slice(
        mainMatch.endLine,
        mainMatch.endLine + contextAfter.length
      );
      for (let i = 0; i < Math.min(contextAfter.length, mdxContextAfter.length); i++) {
        contextScore += this.normalizer.compare(contextAfter[i], mdxContextAfter[i]);
        contextChecks++;
      }
    }

    // Combine scores
    const avgContextScore = contextChecks > 0 ? contextScore / contextChecks : 1.0;
    const combinedScore = 
      this.options.contentWeight * mainMatch.score +
      this.options.contextWeight * avgContextScore;

    return {
      ...mainMatch,
      score: combinedScore,
      contextScore: avgContextScore,
      contextChecks
    };
  }
}

// =============================================================================
// Exports
// =============================================================================

export default FuzzyMatcher;
