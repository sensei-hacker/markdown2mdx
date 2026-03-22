/**
 * GFM to MDX Converter
 * 
 * Converts GitHub Flavored Markdown files to Docusaurus-compatible MDX format.
 * Uses markdown-it for lenient parsing of "loose" markdown, then applies
 * transformations needed for strict MDX compatibility.
 */

import MarkdownIt from 'markdown-it';
import { parse as parseHTML } from 'node-html-parser';
import { LinkRewriter } from './link-rewriter.js';

// =============================================================================
// Configuration
// =============================================================================

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

export const BLOCK_ELEMENTS = new Set([
  'div', 'p', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'dl', 'dt', 'dd', 'figure', 'figcaption',
  'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'details', 'summary'
]);

// =============================================================================
// HTML Fixer - Makes HTML JSX-compliant
// =============================================================================

export class HtmlFixer {
  constructor() {
    this.warnings = [];
  }

  fixAttributes(attrs) {
    if (!attrs?.trim()) return '';
    let fixed = attrs;
    fixed = fixed.replace(/\bclass=/g, 'className=');
    fixed = fixed.replace(/\bfor=/g, 'htmlFor=');
    fixed = fixed.replace(/(\w+)=(\w+)(?=\s|$)/g, '$1="$2"');
    return fixed;
  }

  fixHtmlBlock(html) {
    let fixed = html;
    
    // Fix void elements
    for (const tag of VOID_ELEMENTS) {
      const pattern = new RegExp(`<(${tag})\\b([^>]*?)(?<!/)>`, 'gi');
      fixed = fixed.replace(pattern, (_, name, attrs) => {
        const fixedAttrs = this.fixAttributes(attrs);
        return `<${name}${fixedAttrs} />`;
      });
    }
    
    // Fix attributes in all tags
    fixed = fixed.replace(/<(\w+)([^>]*)>/g, (match, tag, attrs) => {
      if (!attrs.trim()) return match;
      const fixedAttrs = this.fixAttributes(attrs);
      if (VOID_ELEMENTS.has(tag.toLowerCase()) && !match.endsWith('/>')) {
        return `<${tag}${fixedAttrs} />`;
      }
      return `<${tag}${fixedAttrs}>`;
    });

    return fixed;
  }

  validateHtml(html) {
    const issues = [];
    try {
      const root = parseHTML(html, {
        lowerCaseTagName: true,
        comment: true,
        voidTag: { tags: [...VOID_ELEMENTS], closingSlash: true }
      });
      this.walkTree(root, issues);
    } catch (err) {
      issues.push({ type: 'parse_error', message: err.message, severity: 'error' });
    }
    return issues;
  }

  walkTree(node, issues) {
    if (!node.childNodes) return;
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        const tag = child.tagName?.toLowerCase();
        if (child.getAttribute('class')) {
          issues.push({
            type: 'jsx_compat',
            message: `<${tag}> uses 'class' (should be 'className')`,
            severity: 'warning',
            autofix: true
          });
        }
        this.walkTree(child, issues);
      }
    }
  }
}

// =============================================================================
// Admonition Converter
// =============================================================================

export class AdmonitionConverter {
  constructor() {
    this.patterns = [
      // GitHub Alert syntax (>[!TYPE]) — dominant format in current wiki, must come first
      { pattern: /^>\[!note\]\s*/im, type: 'note' },
      { pattern: /^>\[!tip\]\s*/im, type: 'tip' },
      { pattern: /^>\[!warning\]\s*/im, type: 'warning' },
      { pattern: /^>\[!important\]\s*/im, type: 'info' },
      { pattern: /^>\[!caution\]\s*/im, type: 'danger' },
      // Legacy bold-keyword blockquote style
      { pattern: /^>\s*\*\*Note:?\*\*\s*/im, type: 'note' },
      { pattern: /^>\s*\*\*Warning:?\*\*\s*/im, type: 'warning' },
      { pattern: /^>\s*\*\*Tip:?\*\*\s*/im, type: 'tip' },
      { pattern: /^>\s*\*\*Important:?\*\*\s*/im, type: 'important' },
      { pattern: /^>\s*\*\*Caution:?\*\*\s*/im, type: 'caution' },
      { pattern: /^>\s*\*\*Danger:?\*\*\s*/im, type: 'danger' },
      { pattern: /^>\s*⚠️\s*/im, type: 'warning' },
      { pattern: /^>\s*ℹ️\s*/im, type: 'info' },
      { pattern: /^>\s*💡\s*/im, type: 'tip' },
    ];
  }

  convertBlockquote(content) {
    for (const { pattern, type } of this.patterns) {
      if (pattern.test(content)) {
        const body = content.replace(pattern, '').replace(/^>\s*/gm, '').trim();
        return `:::${type}\n${body}\n:::`;
      }
    }
    return null;
  }

  convertAll(content) {
    return content.replace(/^((?:>.*\n?)+)/gm, (match, _p1, offset, str) => {
      const converted = this.convertBlockquote(match);
      if (!converted) return match;
      // Ensure closing ::: is separated from any immediately-following content
      const afterMatch = str.slice(offset + match.length);
      const needsBlankLine = afterMatch.length > 0 && !afterMatch.startsWith('\n');
      return converted + (needsBlankLine ? '\n\n' : '\n');
    });
  }
}

// =============================================================================
// Front Matter Generator
// =============================================================================

export class FrontMatterGenerator {
  generate(options = {}) {
    const { title, sidebarLabel, sidebarPosition, description, slug, tags = [], customFields = {} } = options;
    const fm = {};

    if (sidebarPosition !== undefined) fm.sidebar_position = sidebarPosition;
    if (sidebarLabel) fm.sidebar_label = sidebarLabel;
    if (title) fm.title = title;
    if (description) fm.description = description;
    if (slug) fm.slug = slug;
    if (tags.length > 0) fm.tags = tags;
    Object.assign(fm, customFields);

    return this.toYaml(fm);
  }

  toYaml(obj) {
    if (Object.keys(obj).length === 0) return '';
    const lines = ['---'];
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${this.formatValue(item)}`);
      } else {
        lines.push(`${key}: ${this.formatValue(value)}`);
      }
    }
    lines.push('---');
    return lines.join('\n');
  }

  formatValue(value) {
    if (typeof value === 'string') {
      if (/[:#\[\]{}|>&*!?,\n]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
      return value;
    }
    return String(value);
  }

  extractTitle(content) {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  extractDescription(content, maxLength = 160) {
    const afterH1 = content.replace(/^#\s+.+\n+/, '');
    const firstPara = afterH1.match(/^[^#\n].+/m);
    if (firstPara) {
      let desc = firstPara[0].trim();
      if (desc.length > maxLength) desc = desc.slice(0, maxLength - 3) + '...';
      return desc;
    }
    return null;
  }
}

// =============================================================================
// Main Converter
// =============================================================================

export class GfmToMdxConverter {
  constructor(options = {}) {
    this.options = {
      addFrontMatter: true,
      minimalFrontMatter: false, // When true, only emit title: (matches manual docs style)
      validateHtml: true,
      escapeJsxChars: true,
      convertAdmonitions: true,
      rewriteLinks: false,       // When true, rewrite wiki URLs and [[links]]
      fixSelfClosingTags: true,
      preserveExistingFrontMatter: true,
      verbose: false,
      ...options
    };

    // Link rewriter is set externally via setLinkRewriter() when rewriteLinks is enabled
    this.linkRewriter = null;

    this.md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
    this.htmlFixer = new HtmlFixer();
    this.admonitionConverter = new AdmonitionConverter();
    this.frontMatterGenerator = new FrontMatterGenerator();
    this.linkRewriter = null;
    
    this.warnings = [];
    this.errors = [];
    this.changes = [];
  }

  /**
   * Set the link rewriter for this converter instance.
   * Call this before convert() when rewriteLinks is enabled.
   * @param {LinkRewriter} rewriter
   */
  setLinkRewriter(rewriter) {
    this.linkRewriter = rewriter;
  }

  convert(content, options = {}) {
    this.warnings = [];
    this.errors = [];
    this.changes = [];

    let result = content;

    // Step 1: Extract existing front matter
    const { frontMatter: existingFm, body } = this.extractFrontMatter(result);
    result = body;

    // Step 2: Parse to find protected regions
    const tokens = this.md.parse(result, {});
    const protectedRegions = this.findProtectedRegions(result);

    // Step 3: Escape MDX-problematic characters
    if (this.options.escapeJsxChars) {
      result = this.escapeWithProtection(result, protectedRegions);
    }

    // Step 4: Fix HTML for JSX compatibility
    if (this.options.fixSelfClosingTags || this.options.validateHtml) {
      result = this.fixHtmlInContent(result, protectedRegions);
    }

    // Step 5: Convert admonitions
    if (this.options.convertAdmonitions) {
      result = this.admonitionConverter.convertAll(result);
    }

    // Step 6: Rewrite wiki links to relative docs paths
    if (this.options.rewriteLinks && this.linkRewriter) {
      const before = result;
      result = this.linkRewriter.rewriteAll(result);
      if (result !== before) {
        this.changes.push({ type: 'link_rewrite', reason: 'Wiki links rewritten to relative paths' });
      }
    }

    // Step 7: Handle front matter
    if (this.options.addFrontMatter) {
      const newFm = this.generateFrontMatter(result, options, existingFm);
      if (newFm) result = newFm + '\n\n' + result;
    } else if (existingFm && this.options.preserveExistingFrontMatter) {
      result = existingFm + '\n\n' + result;
    }

    return { content: result, warnings: this.warnings, errors: this.errors, changes: this.changes };
  }

  extractFrontMatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (match) {
      return { frontMatter: match[0].trim(), body: content.slice(match[0].length).trim() };
    }
    return { frontMatter: null, body: content };
  }

  findProtectedRegions(content) {
    const regions = [];

    // Fenced code blocks
    let match;
    const fencePattern = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1/gm;
    while ((match = fencePattern.exec(content)) !== null) {
      regions.push({ start: match.index, end: match.index + match[0].length, type: 'fence' });
    }

    // Inline code
    const inlinePattern = /`[^`\n]+`/g;
    while ((match = inlinePattern.exec(content)) !== null) {
      regions.push({ start: match.index, end: match.index + match[0].length, type: 'inline' });
    }

    return regions.sort((a, b) => a.start - b.start);
  }

  isProtected(pos, regions) {
    for (const region of regions) {
      if (pos >= region.start && pos < region.end) return true;
      if (region.start > pos) break;
    }
    return false;
  }

  escapeWithProtection(content, protectedRegions) {
    const result = [];
    let i = 0;

    while (i < content.length) {
      // Check if entering protected region
      const region = protectedRegions.find(r => r.start === i);
      if (region) {
        result.push(content.slice(region.start, region.end));
        i = region.end;
        continue;
      }

      if (this.isProtected(i, protectedRegions)) {
        result.push(content[i]);
        i++;
        continue;
      }

      const remaining = content.slice(i);

      // Pattern: word<digit (Air<2g, version<5)
      const techSpec = remaining.match(/^(\w+)<(\d+\w*)/);
      if (techSpec) {
        const replacement = techSpec[1] + '\\<' + techSpec[2];
        result.push(replacement);
        this.changes.push({ type: 'escape', original: techSpec[0], replacement, reason: 'Technical spec' });
        i += techSpec[0].length;
        continue;
      }

      // Pattern: Generic<Type>
      const generic = remaining.match(/^(\w+)<(\w+)>/);
      if (generic) {
        const replacement = generic[1] + '\\<' + generic[2] + '\\>';
        result.push(replacement);
        this.changes.push({ type: 'escape', original: generic[0], replacement, reason: 'Generic type' });
        i += generic[0].length;
        continue;
      }

      // Pattern: <PLACEHOLDER>
      const placeholder = remaining.match(/^<([A-Z][A-Z0-9_]*)>/);
      if (placeholder) {
        const replacement = '\\<' + placeholder[1] + '\\>';
        result.push(replacement);
        this.changes.push({ type: 'escape', original: placeholder[0], replacement, reason: 'Placeholder' });
        i += placeholder[0].length;
        continue;
      }

      // Pattern: comparison operators (<5, >10, <=20) preceded by whitespace
      const comparison = remaining.match(/^([<>]=?)(\d)/);
      if (comparison && (i === 0 || /\s/.test(content[i - 1])) && !remaining.match(/^<\/?[a-zA-Z]/)) {
        const op = comparison[1].replace(/</g, '\\<').replace(/>/g, '\\>');
        result.push(op + comparison[2]);
        this.changes.push({ type: 'escape', original: comparison[0], replacement: op + comparison[2], reason: 'Comparison' });
        i += comparison[0].length;
        continue;
      }

      // Pattern: {simple_content} that looks like a literal, not JSX
      if (content[i] === '{') {
        const braces = remaining.match(/^\{([^}]*)\}/);
        if (braces) {
          const inner = braces[1];
          // Escape if it looks like a range/value, not a JS expression
          if (/^[\w\s\-,.:\/]+$/.test(inner) && !/^[a-z_$][\w$]*$/i.test(inner.trim())) {
            const replacement = '\\{' + inner + '\\}';
            result.push(replacement);
            this.changes.push({ type: 'escape', original: braces[0], replacement, reason: 'Literal braces' });
            i += braces[0].length;
            continue;
          }
        }
      }

      result.push(content[i]);
      i++;
    }

    return result.join('');
  }

  fixHtmlInContent(content, protectedRegions) {
    let result = content;

    // Fix void elements
    for (const tag of VOID_ELEMENTS) {
      const pattern = new RegExp(`<(${tag})\\b([^>]*?)(?<!/)>`, 'gi');
      result = result.replace(pattern, (match, name, attrs, offset) => {
        if (this.isProtected(offset, protectedRegions)) return match;
        const fixed = `<${name}${this.htmlFixer.fixAttributes(attrs)} />`;
        if (fixed !== match) {
          this.changes.push({ type: 'html_fix', original: match, replacement: fixed, reason: 'Self-closing void element' });
        }
        return fixed;
      });
    }

    // Fix class -> className
    result = result.replace(/<(\w+)([^>]*)\bclass=([^>]*)>/g, (match, tag, before, after, offset) => {
      if (this.isProtected(offset, protectedRegions)) return match;
      const fixed = `<${tag}${before}className=${after}>`;
      if (fixed !== match) {
        this.changes.push({ type: 'html_fix', original: match, replacement: fixed, reason: 'class → className' });
      }
      return fixed;
    });

    // Validate HTML blocks
    if (this.options.validateHtml) {
      const htmlBlockPattern = /<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g;
      let match;
      while ((match = htmlBlockPattern.exec(result)) !== null) {
        if (!this.isProtected(match.index, protectedRegions)) {
          const issues = this.htmlFixer.validateHtml(match[0]);
          for (const issue of issues) {
            (issue.severity === 'error' ? this.errors : this.warnings).push(issue.message);
          }
        }
      }
    }

    return result;
  }

  generateFrontMatter(content, options, existingFm) {
    if (existingFm && this.options.preserveExistingFrontMatter) return existingFm;

    if (this.options.minimalFrontMatter) {
      // Match manual docs style: just title, nothing else
      const title = options.title || this.frontMatterGenerator.extractTitle(content);
      return this.frontMatterGenerator.generate({ title });
    }

    const fmOptions = { ...options };
    if (!fmOptions.title) fmOptions.title = this.frontMatterGenerator.extractTitle(content);
    if (!fmOptions.sidebarLabel && fmOptions.title) fmOptions.sidebarLabel = fmOptions.title;
    if (!fmOptions.description) fmOptions.description = this.frontMatterGenerator.extractDescription(content);

    return this.frontMatterGenerator.generate(fmOptions);
  }

  getSummary() {
    return {
      totalChanges: this.changes.length,
      escapes: this.changes.filter(c => c.type === 'escape').length,
      htmlFixes: this.changes.filter(c => c.type === 'html_fix').length,
      warnings: this.warnings.length,
      errors: this.errors.length,
      changes: this.changes
    };
  }
}

export default GfmToMdxConverter;
