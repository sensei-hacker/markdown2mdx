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
import { buildPageMapping, LinkRewriter } from './transforms/links.js';
import { ImageRewriter } from './transforms/images.js';

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
    rewriteImages: false,
    staticDir: null,
    downloadImages: false,
    generateCategoryJson: false,
    noEscape: false,
    noHtmlFix: false,
    linkBase: null,   // root dir for computing relative link paths
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

      case '--rewrite-images':
        options.rewriteImages = true;
        break;

      case '--static-dir':
        options.staticDir = args[++i];
        break;

      case '--download-images':
        options.downloadImages = true;
        options.rewriteImages = true;
        break;

      case '--category-json':
        options.generateCategoryJson = true;
        break;

      case '--no-admonitions':
        options.noAdmonitions = true;
        break;

      case '--link-base':
        options.linkBase = args[++i];
        break;

      case '--no-escape':
        options.noEscape = true;
        break;

      case '--validate-anchors':
        options.validateAnchors = true;
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

/**
 * Compute the output file's path relative to the link-base directory.
 * This tells the LinkRewriter where the output file sits in the docs tree
 * so it can generate correct relative links.
 *
 * @param {string|null} outputPath  Absolute or relative output file path
 * @param {object} options          CLI options (linkBase, docsDir)
 * @param {string} stem             Filename stem (fallback)
 * @returns {string}  Path relative to link base (e.g. 'features/Failsafe.md')
 */
function computeRelativeOutputPath(outputPath, options, stem) {
  const absOutput = outputPath ? path.resolve(outputPath) : null;
  const linkBase = options.linkBase
    ? path.resolve(options.linkBase)
    : options.docsDir
      ? path.resolve(options.docsDir)
      : null;

  if (absOutput && linkBase) return path.relative(linkBase, absOutput);
  if (absOutput) return path.basename(absOutput);
  return stem + '.md';
}

async function processFile(inputPath, outputPath, converter, options, sidebarPosition, pageMapping, imageRewriter) {
  const content = await fs.readFile(inputPath, 'utf-8');

  // Determine sidebar label and stem from filename
  const stem = path.basename(inputPath, path.extname(inputPath));

  // Set up link rewriter if enabled
  if (options.rewriteLinks && pageMapping) {
    const relOutputPath = computeRelativeOutputPath(outputPath, options, stem);
    converter.setLinkRewriter(new LinkRewriter(pageMapping, relOutputPath, options.validateAnchors));
  }

  if (options.rewriteImages && imageRewriter) {
    converter.setImageRewriter(imageRewriter);
  }

  const sidebarLabel = stem.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const result = converter.convert(content, {
    sidebarPosition,
    sidebarLabel,
    stem,
  });

  if (!options.dryRun && outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, result.content, 'utf-8');
    if (!options.quiet) {
      console.log(`  ${inputPath} -> ${outputPath}`);
    }
  } else if (options.dryRun) {
    if (!options.quiet) {
      console.log(`  [dry-run] ${inputPath} -> ${outputPath || 'stdout'}`);
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

  // Build page mapping for link rewriting if requested
  let pageMapping = null;
  if (options.rewriteLinks) {
    const baseDocsDir = options.docsDir || outputDir;
    if (!options.quiet) console.log(`Building page mapping from ${baseDocsDir}...`);
    pageMapping = buildPageMapping(baseDocsDir);
    if (!options.quiet) console.log(`  Found ${pageMapping.size} page mappings\n`);
  }

  // Create image rewriter shared across all files
  const imageRewriter = options.rewriteImages
    ? new ImageRewriter(options.staticDir ? { staticDir: options.staticDir } : {})
    : null;

  let categoryPosition = 1;
  let filesProcessed = 0;

  for (const [dir, dirFiles] of byDir) {
    let position = options.sidebarStart;

    // Generate _category_.json for subdirectories
    if (options.generateCategoryJson && !options.dryRun) {
      const relDir = path.relative(inputDir, dir);
      if (relDir) {
        // It's a subdirectory, not the root
        const outputSubDir = path.join(outputDir, relDir);
        const categoryPath = path.join(outputSubDir, '_category_.json');
        const label = path.basename(dir)
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        const categoryJson = { label, position: categoryPosition++ };
        await fs.mkdir(outputSubDir, { recursive: true });
        await fs.writeFile(categoryPath, JSON.stringify(categoryJson, null, 2) + '\n', 'utf-8');
        if (!options.quiet) console.log(`  _category_.json -> ${categoryPath}`);
      }
    }

    for (const inputPath of dirFiles) {
      const relativePath = path.relative(inputDir, inputPath);
      const outputPath = path.join(outputDir, relativePath);
      await processFile(inputPath, outputPath, converter, options, position, pageMapping, imageRewriter);
      position++;
      filesProcessed++;
    }
  }

  if (!options.quiet) {
    console.log(`\nDone: ${filesProcessed} files processed`);
    if (options.dryRun) console.log(`  (dry-run mode - no files written)`);
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
    rewriteImages: options.rewriteImages,
    escapeJsxChars: !options.noEscape,
    fixSelfClosingTags: !options.noHtmlFix,
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
      const imageRewriter = options.rewriteImages
        ? new ImageRewriter(options.staticDir ? { staticDir: options.staticDir } : {})
        : null;
      await processFile(options.input, options.output, converter, options, options.sidebarStart, pageMapping, imageRewriter);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (options.verbose) console.error(err.stack);
    process.exit(1);
  }
}

main();
