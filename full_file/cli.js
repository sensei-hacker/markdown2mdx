#!/usr/bin/env node

/**
 * GFM to MDX Converter - CLI
 * 
 * Usage:
 *   gfm2mdx <input> [output] [options]
 *   gfm2mdx --dir <inputDir> <outputDir> [options]
 * 
 * Examples:
 *   gfm2mdx README.md                     # Convert single file, output to stdout
 *   gfm2mdx README.md README.mdx          # Convert single file to specific output
 *   gfm2mdx --dir ./wiki ./docs           # Convert entire directory
 *   gfm2mdx --dir ./wiki ./docs --dry-run # Preview changes without writing
 */

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { GfmToMdxConverter } from './converter.js';
import { buildPageMapping, LinkRewriter } from './link-rewriter.js';

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(args) {
  const options = {
    input: null,
    output: null,
    dir: false,
    inputDir: null,
    outputDir: null,
    dryRun: false,
    verbose: false,
    quiet: false,
    noFrontMatter: false,
    minimalFrontMatter: false,
    noAdmonitions: false,
    rewriteLinks: false,
    docsDir: null,
    noEscape: false,
    noHtmlFix: false,
    sidebarStart: 1,
    recursive: true,
    extension: '.md',
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;

      case '-d':
      case '--dir':
        options.dir = true;
        options.inputDir = args[++i];
        options.outputDir = args[++i];
        break;

      case '--dry-run':
        options.dryRun = true;
        break;

      case '-v':
      case '--verbose':
        options.verbose = true;
        break;

      case '-q':
      case '--quiet':
        options.quiet = true;
        break;

      case '--no-front-matter':
        options.noFrontMatter = true;
        break;

      case '--minimal-front-matter':
        options.minimalFrontMatter = true;
        break;

      case '--rewrite-links':
        options.rewriteLinks = true;
        break;

      case '--docs-dir':
        options.docsDir = args[++i];
        break;

      case '--no-admonitions':
        options.noAdmonitions = true;
        break;

      case '--no-escape':
        options.noEscape = true;
        break;

      case '--no-html-fix':
        options.noHtmlFix = true;
        break;

      case '--sidebar-start':
        options.sidebarStart = parseInt(args[++i], 10);
        break;

      case '--no-recursive':
        options.recursive = false;
        break;

      case '--ext':
        options.extension = args[++i];
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        if (!options.input) {
          options.input = arg;
        } else if (!options.output) {
          options.output = arg;
        }
    }
    i++;
  }

  return options;
}

function printHelp() {
  console.log(`
GFM to MDX Converter

Converts GitHub Flavored Markdown to Docusaurus-compatible MDX format.

USAGE:
  gfm2mdx <input> [output] [options]     Convert a single file
  gfm2mdx --dir <in> <out> [options]     Convert a directory

ARGUMENTS:
  <input>     Input markdown file
  [output]    Output file (default: stdout for single file)

OPTIONS:
  -h, --help            Show this help message
  -d, --dir <in> <out>  Convert all files in directory
  -v, --verbose         Show detailed output
  -q, --quiet           Suppress non-error output
  --dry-run             Preview changes without writing files
  --no-front-matter     Don't add Docusaurus front matter
  --no-admonitions      Don't convert blockquotes to admonitions
  --no-escape           Don't escape < and { characters
  --no-html-fix         Don't fix HTML for JSX compatibility
  --sidebar-start <n>   Starting sidebar_position (default: 1)
  --no-recursive        Don't process subdirectories
  --ext <ext>           File extension to process (default: .md)

EXAMPLES:
  # Convert single file
  gfm2mdx wiki/Home.md docs/intro.md

  # Convert with options
  gfm2mdx README.md --no-front-matter

  # Convert entire wiki directory
  gfm2mdx --dir ./wiki.git ./versioned_docs/version-4.0.0

  # Preview changes
  gfm2mdx --dir ./wiki ./docs --dry-run --verbose

TRANSFORMATIONS:
  • Escapes < in text like "Air<2g" or "Array<T>"
  • Escapes { } when they look like literals, not JSX
  • Converts void elements (<br>, <img>) to self-closing (<br />)
  • Converts class= to className=
  • Converts **Note:** blockquotes to :::note admonitions
  • Adds sidebar_position, sidebar_label, title front matter
`);
}

// =============================================================================
// File Processing
// =============================================================================

async function processFile(inputPath, outputPath, converter, options, sidebarPosition, pageMapping) {
  const content = await fs.readFile(inputPath, 'utf-8');

  // Determine sidebar label from filename
  const basename = path.basename(inputPath, path.extname(inputPath));
  const sidebarLabel = basename.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Set up link rewriter if enabled
  if (options.rewriteLinks && pageMapping) {
    // Use outputPath if available; fall back to input filename for relative link computation
    const effectivePath = outputPath || path.basename(inputPath);
    const outputBase = options.outputDir || (outputPath ? path.dirname(outputPath) : '');
    const relOutputPath = outputBase ? path.relative(outputBase, effectivePath) : effectivePath;
    converter.setLinkRewriter(new LinkRewriter(pageMapping, relOutputPath));
  }

  const result = converter.convert(content, {
    sidebarPosition,
    sidebarLabel,
  });

  if (options.verbose) {
    console.log(`\n📄 ${inputPath}`);
    const summary = converter.getSummary();
    if (summary.totalChanges > 0) {
      console.log(`   Changes: ${summary.totalChanges} (${summary.escapes} escapes, ${summary.htmlFixes} HTML fixes)`);
      for (const change of summary.changes) {
        console.log(`   • ${change.reason}: "${change.original}" → "${change.replacement}"`);
      }
    }
    if (summary.warnings > 0) {
      console.log(`   ⚠️  Warnings: ${summary.warnings}`);
      for (const w of converter.warnings) console.log(`      ${w}`);
    }
    if (summary.errors > 0) {
      console.log(`   ❌ Errors: ${summary.errors}`);
      for (const e of converter.errors) console.log(`      ${e}`);
    }
  }

  if (!options.dryRun && outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, result.content, 'utf-8');
    if (!options.quiet) {
      console.log(`✅ ${inputPath} → ${outputPath}`);
    }
  } else if (options.dryRun) {
    if (!options.quiet) {
      console.log(`🔍 [dry-run] ${inputPath} → ${outputPath || 'stdout'}`);
    }
  } else {
    // Output to stdout
    process.stdout.write(result.content);
  }

  return result;
}

async function processDirectory(inputDir, outputDir, converter, options) {
  const pattern = options.recursive 
    ? `${inputDir}/**/*${options.extension}`
    : `${inputDir}/*${options.extension}`;

  const files = await glob(pattern, { nodir: true });
  
  if (files.length === 0) {
    console.error(`No ${options.extension} files found in ${inputDir}`);
    process.exit(1);
  }

  if (!options.quiet) {
    console.log(`Found ${files.length} file(s) to convert\n`);
  }

  // Group files by directory for sidebar positioning
  const byDir = new Map();
  for (const file of files) {
    const dir = path.dirname(file);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(file);
  }

  // Sort files within each directory
  for (const [dir, dirFiles] of byDir) {
    dirFiles.sort((a, b) => {
      // Sort index/readme first
      const aBase = path.basename(a, path.extname(a)).toLowerCase();
      const bBase = path.basename(b, path.extname(b)).toLowerCase();
      if (aBase === 'index' || aBase === 'readme' || aBase === 'home') return -1;
      if (bBase === 'index' || bBase === 'readme' || bBase === 'home') return 1;
      return aBase.localeCompare(bBase);
    });
  }

  let totalChanges = 0;
  let totalWarnings = 0;
  let totalErrors = 0;

  // Build page mapping for link rewriting if requested
  let pageMapping = null;
  if (options.rewriteLinks) {
    const baseDocsDir = options.docsDir || outputDir;
    if (!options.quiet) console.log(`Building page mapping from ${baseDocsDir}...`);
    pageMapping = buildPageMapping(baseDocsDir);
    if (!options.quiet) console.log(`  Found ${pageMapping.size} page mappings\n`);
  }

  for (const [dir, dirFiles] of byDir) {
    let position = options.sidebarStart;

    for (const inputPath of dirFiles) {
      const relativePath = path.relative(inputDir, inputPath);
      const outputPath = path.join(outputDir, relativePath);

      const result = await processFile(inputPath, outputPath, converter, options, position, pageMapping);

      const summary = converter.getSummary();
      totalChanges += summary.totalChanges;
      totalWarnings += summary.warnings;
      totalErrors += summary.errors;

      position++;
    }
  }

  if (!options.quiet) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📊 Summary:`);
    console.log(`   Files processed: ${files.length}`);
    console.log(`   Total changes: ${totalChanges}`);
    if (totalWarnings > 0) console.log(`   ⚠️  Warnings: ${totalWarnings}`);
    if (totalErrors > 0) console.log(`   ❌ Errors: ${totalErrors}`);
    if (options.dryRun) console.log(`\n   (dry-run mode - no files written)`);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || (args.length === 0)) {
    printHelp();
    process.exit(0);
  }

  const converter = new GfmToMdxConverter({
    addFrontMatter: !options.noFrontMatter,
    minimalFrontMatter: options.minimalFrontMatter,
    convertAdmonitions: !options.noAdmonitions,
    rewriteLinks: options.rewriteLinks,
    escapeJsxChars: !options.noEscape,
    fixSelfClosingTags: !options.noHtmlFix,
    validateHtml: !options.noHtmlFix,
    verbose: options.verbose,
  });

  try {
    if (options.dir) {
      if (!options.inputDir || !options.outputDir) {
        console.error('Error: --dir requires both input and output directories');
        process.exit(1);
      }
      await processDirectory(options.inputDir, options.outputDir, converter, options);
    } else {
      if (!options.input) {
        console.error('Error: No input file specified');
        process.exit(1);
      }
      let pageMapping = null;
      if (options.rewriteLinks && options.docsDir) {
        pageMapping = buildPageMapping(options.docsDir);
      }
      await processFile(options.input, options.output, converter, options, options.sidebarStart, pageMapping);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (options.verbose) console.error(err.stack);
    process.exit(1);
  }
}

main();
