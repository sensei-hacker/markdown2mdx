/**
 * GFM to MDX Transformer
 * 
 * Transforms GFM content to MDX format.
 * Simplified version focused on the transformations needed for the merge tool.
 */

// =============================================================================
// Constants
// =============================================================================

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

// =============================================================================
// Transformer Class
// =============================================================================

export class GfmToMdxTransformer {
  constructor(options = {}) {
    this.options = {
      escapeJsxChars: true,
      fixHtml: true,
      ...options
    };
  }

  /**
   * Transform a single line of GFM to MDX
   */
  transformLine(line) {
    let result = line;

    if (this.options.escapeJsxChars) {
      result = this.escapeJsxChars(result);
    }

    if (this.options.fixHtml) {
      result = this.fixHtmlTags(result);
    }

    return result;
  }

  /**
   * Transform multiple lines, preserving code blocks
   */
  transformLines(lines) {
    const result = [];
    let inCodeBlock = false;
    let codeBlockMarker = null;

    for (const line of lines) {
      // Check for code fence
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockMarker = fenceMatch[1][0];
          result.push(line);
        } else if (line.startsWith(codeBlockMarker.repeat(3))) {
          inCodeBlock = false;
          codeBlockMarker = null;
          result.push(line);
        } else {
          result.push(line);
        }
        continue;
      }

      // Don't transform code block content
      if (inCodeBlock) {
        result.push(line);
        continue;
      }

      // Don't transform indented code (4 spaces)
      if (line.match(/^    /)) {
        result.push(line);
        continue;
      }

      // Transform the line
      result.push(this.transformLine(line));
    }

    return result;
  }

  /**
   * Transform full content string
   */
  transform(content) {
    const lines = content.split('\n');
    const transformed = this.transformLines(lines);
    return transformed.join('\n');
  }

  /**
   * Escape characters that have special meaning in MDX/JSX
   */
  escapeJsxChars(line) {
    let result = line;

    // Don't escape inside inline code
    const codeSegments = [];
    result = result.replace(/`[^`]+`/g, (match, offset) => {
      const placeholder = `__CODE_${codeSegments.length}__`;
      codeSegments.push(match);
      return placeholder;
    });

    // Pattern: word<digit (Air<2g, version<5)
    result = result.replace(/(\w+)<(\d+\w*)/g, '$1\\<$2');

    // Pattern: Generic<Type>
    result = result.replace(/(\w+)<(\w+)>/g, '$1\\<$2\\>');

    // Pattern: <PLACEHOLDER>
    result = result.replace(/<([A-Z][A-Z0-9_]*)>/g, '\\<$1\\>');

    // Pattern: comparison operators preceded by whitespace
    result = result.replace(/(\s)([<>]=?)(\d)/g, '$1\\$2$3');

    // Pattern: literal braces with simple content
    result = result.replace(/\{(\d[\d\-,.\s]*)\}/g, '\\{$1\\}');
    result = result.replace(/\{(\d+\s*-\s*\d+)\}/g, '\\{$1\\}');

    // Restore inline code
    for (let i = 0; i < codeSegments.length; i++) {
      result = result.replace(`__CODE_${i}__`, codeSegments[i]);
    }

    return result;
  }

  /**
   * Fix HTML tags for JSX compatibility
   */
  fixHtmlTags(line) {
    let result = line;

    // Fix void elements to be self-closing
    for (const tag of VOID_ELEMENTS) {
      const pattern = new RegExp(`<(${tag})\\b([^>]*?)(?<!/)>`, 'gi');
      result = result.replace(pattern, '<$1$2 />');
    }

    // Fix class -> className
    result = result.replace(/(<\w+[^>]*)\bclass=/g, '$1className=');

    // Fix for -> htmlFor
    result = result.replace(/(<\w+[^>]*)\bfor=/g, '$1htmlFor=');

    return result;
  }
}

// =============================================================================
// Inverse Transformer (for understanding existing MDX)
// =============================================================================

export class MdxToGfmTransformer {
  /**
   * Reverse MDX escapes to GFM (for comparison purposes)
   */
  transform(content) {
    let result = content;

    // Remove escape backslashes
    result = result.replace(/\\</g, '<');
    result = result.replace(/\\>/g, '>');
    result = result.replace(/\\{/g, '{');
    result = result.replace(/\\}/g, '}');

    // Convert className back to class
    result = result.replace(/\bclassName=/g, 'class=');

    // Convert htmlFor back to for
    result = result.replace(/\bhtmlFor=/g, 'for=');

    // Remove self-closing from void elements (optional, for comparison)
    // result = result.replace(/<(br|hr|img)([^>]*)\s*\/>/gi, '<$1$2>');

    return result;
  }
}

// =============================================================================
// Exports
// =============================================================================

export { VOID_ELEMENTS };
export default GfmToMdxTransformer;
