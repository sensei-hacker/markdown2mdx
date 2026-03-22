/**
 * Git Diff Parser
 * 
 * Parses unified diff format and extracts structured hunk information.
 */

// =============================================================================
// Diff Hunk Representation
// =============================================================================

/**
 * @typedef {Object} DiffHunk
 * @property {number} oldStart - Starting line in original file
 * @property {number} oldCount - Number of lines in original
 * @property {number} newStart - Starting line in new file  
 * @property {number} newCount - Number of lines in new file
 * @property {string[]} contextBefore - Context lines before change
 * @property {string[]} removals - Lines being removed (without - prefix)
 * @property {string[]} additions - Lines being added (without + prefix)
 * @property {string[]} contextAfter - Context lines after change
 * @property {string} raw - Raw hunk text
 */

// =============================================================================
// Diff Parser Class
// =============================================================================

export class DiffParser {
  constructor() {
    this.hunks = [];
    this.oldFile = null;
    this.newFile = null;
  }

  /**
   * Parse a unified diff string
   */
  parse(diffText) {
    this.hunks = [];
    this.oldFile = null;
    this.newFile = null;

    const lines = diffText.split('\n');
    let i = 0;

    // Parse header
    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('---')) {
        this.oldFile = this.parseFilePath(line.slice(4));
      } else if (line.startsWith('+++')) {
        this.newFile = this.parseFilePath(line.slice(4));
      } else if (line.startsWith('@@')) {
        // Start of hunk
        break;
      }
      i++;
    }

    // Parse hunks
    while (i < lines.length) {
      if (lines[i].startsWith('@@')) {
        const hunk = this.parseHunk(lines, i);
        this.hunks.push(hunk);
        i = hunk.endIndex;
      } else {
        i++;
      }
    }

    return {
      oldFile: this.oldFile,
      newFile: this.newFile,
      hunks: this.hunks
    };
  }

  /**
   * Parse file path from diff header line
   */
  parseFilePath(pathLine) {
    // Handle "a/path/to/file" or "b/path/to/file" format
    let path = pathLine.trim();
    if (path.startsWith('a/') || path.startsWith('b/')) {
      path = path.slice(2);
    }
    // Remove timestamp if present
    const tabIndex = path.indexOf('\t');
    if (tabIndex !== -1) {
      path = path.slice(0, tabIndex);
    }
    return path;
  }

  /**
   * Parse a single hunk starting at line index i
   */
  parseHunk(lines, startIndex) {
    const headerLine = lines[startIndex];
    const header = this.parseHunkHeader(headerLine);

    const hunk = {
      ...header,
      contextBefore: [],
      removals: [],
      additions: [],
      contextAfter: [],
      lines: [],  // All lines in order with their types
      raw: headerLine + '\n',
      startIndex,
      endIndex: startIndex + 1
    };

    let i = startIndex + 1;
    let inChanges = false;
    let changesEnded = false;

    while (i < lines.length) {
      const line = lines[i];

      // End of hunk conditions
      if (line.startsWith('@@') || line.startsWith('diff ') || 
          line.startsWith('---') || line.startsWith('+++')) {
        break;
      }

      // Handle "\ No newline at end of file"
      if (line.startsWith('\\ ')) {
        hunk.raw += line + '\n';
        i++;
        continue;
      }

      const prefix = line[0] || ' ';
      const content = line.slice(1);

      if (prefix === '-') {
        inChanges = true;
        hunk.removals.push(content);
        hunk.lines.push({ type: 'removal', content });
      } else if (prefix === '+') {
        inChanges = true;
        hunk.additions.push(content);
        hunk.lines.push({ type: 'addition', content });
      } else if (prefix === ' ' || line === '') {
        if (!inChanges) {
          hunk.contextBefore.push(content);
        } else {
          changesEnded = true;
          hunk.contextAfter.push(content);
        }
        hunk.lines.push({ type: 'context', content });
      }

      hunk.raw += line + '\n';
      i++;
    }

    hunk.endIndex = i;
    return hunk;
  }

  /**
   * Parse hunk header line: @@ -old,count +new,count @@
   */
  parseHunkHeader(line) {
    const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      throw new Error(`Invalid hunk header: ${line}`);
    }

    return {
      oldStart: parseInt(match[1], 10),
      oldCount: match[2] ? parseInt(match[2], 10) : 1,
      newStart: parseInt(match[3], 10),
      newCount: match[4] ? parseInt(match[4], 10) : 1
    };
  }

  /**
   * Classify a hunk based on what region type it affects
   * Only considers the actual change lines, not context
   */
  classifyHunk(hunk, gfmContent) {
    const lines = gfmContent.split('\n');
    const regions = this.findRegions(gfmContent);
    
    let inCode = false;
    let inProse = false;

    // Check removals and additions, not context
    const changeLines = [...hunk.removals, ...hunk.additions];
    
    // Also check what line numbers the changes affect
    const startLine = hunk.oldStart - 1;  // Convert to 0-indexed
    const affectedLines = [];
    
    // Walk through hunk lines to find actual change positions
    let currentLine = startLine;
    for (const lineInfo of hunk.lines) {
      if (lineInfo.type === 'removal') {
        affectedLines.push(currentLine);
        currentLine++;
      } else if (lineInfo.type === 'addition') {
        // Additions don't consume original lines
        affectedLines.push(currentLine);
      } else {
        currentLine++;
      }
    }

    // Check if affected lines are in code regions
    for (const lineNum of affectedLines) {
      const lineRegion = this.getLineRegion(lineNum, regions);
      if (lineRegion === 'code') {
        inCode = true;
      } else {
        inProse = true;
      }
    }
    
    // Also check the content of the changes themselves
    for (const line of changeLines) {
      // If the line is a fence marker, it's transitioning
      if (/^(`{3,}|~{3,})/.test(line)) {
        inCode = true;
        inProse = true;  // Fence transitions are mixed
      }
    }

    if (inCode && inProse) {
      return 'mixed';
    } else if (inCode) {
      return 'code';
    } else {
      return 'prose';
    }
  }

  /**
   * Find code block regions in content
   */
  findRegions(content) {
    const regions = [];
    const lines = content.split('\n');
    let inFence = false;
    let fenceStart = -1;
    let fencePattern = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);

      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceStart = i;
          fencePattern = fenceMatch[1][0];  // ` or ~
        } else if (line.startsWith(fencePattern.repeat(3))) {
          regions.push({ type: 'code', start: fenceStart, end: i });
          inFence = false;
          fencePattern = null;
        }
      }
    }

    // Handle unclosed fence
    if (inFence) {
      regions.push({ type: 'code', start: fenceStart, end: lines.length - 1 });
    }

    return regions;
  }

  /**
   * Get region type for a specific line
   */
  getLineRegion(lineIndex, regions) {
    for (const region of regions) {
      if (lineIndex >= region.start && lineIndex <= region.end) {
        return region.type;
      }
    }
    return 'prose';
  }

  /**
   * Extract the affected lines from original content based on hunk
   */
  getAffectedContent(hunk, content) {
    const lines = content.split('\n');
    const startLine = hunk.oldStart - 1;  // Convert to 0-indexed
    const endLine = startLine + hunk.oldCount;
    return lines.slice(startLine, endLine);
  }

  /**
   * Apply a hunk to content, returning new content
   */
  applyHunk(hunk, content) {
    const lines = content.split('\n');
    const startLine = hunk.oldStart - 1;

    // Build the replacement lines
    const newLines = [];
    
    // Add context before
    for (const ctx of hunk.contextBefore) {
      newLines.push(ctx);
    }
    
    // Add additions (removals are simply not included)
    for (const add of hunk.additions) {
      newLines.push(add);
    }
    
    // Add context after
    for (const ctx of hunk.contextAfter) {
      newLines.push(ctx);
    }

    // Replace the old lines with new lines
    const before = lines.slice(0, startLine);
    const after = lines.slice(startLine + hunk.oldCount);
    
    return [...before, ...newLines, ...after].join('\n');
  }
}

// =============================================================================
// Hunk Transformer
// =============================================================================

export class HunkTransformer {
  /**
   * Transform hunk content from GFM to MDX format
   */
  transformHunk(hunk, transformer) {
    const transformedHunk = { ...hunk };

    // Transform additions (these are the new content being added)
    transformedHunk.additions = hunk.additions.map(line => {
      // Only transform prose lines, not code
      if (this.isCodeLine(line)) {
        return line;
      }
      return transformer(line);
    });

    // Context lines might also need transformation if they weren't
    // properly transformed in the original MDX
    transformedHunk.contextBefore = hunk.contextBefore.map(line => {
      if (this.isCodeLine(line)) return line;
      return transformer(line);
    });

    transformedHunk.contextAfter = hunk.contextAfter.map(line => {
      if (this.isCodeLine(line)) return line;
      return transformer(line);
    });

    return transformedHunk;
  }

  /**
   * Check if a line looks like code (heuristic)
   */
  isCodeLine(line) {
    // Indented by 4+ spaces (code block)
    if (/^    /.test(line)) return true;
    // Fence markers
    if (/^(`{3,}|~{3,})/.test(line)) return true;
    return false;
  }
}

// =============================================================================
// Exports
// =============================================================================

export default DiffParser;
