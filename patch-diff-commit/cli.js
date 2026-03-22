#!/usr/bin/env node

/**
 * GFM-MDX Merge Tool - CLI
 * 
 * Usage:
 *   gfm-mdx-merge <gfm-file> <mdx-file> <diff-file> [options]
 *   gfm-mdx-merge <gfm-file> <mdx-file> --diff-stdin [options]
 * 
 * Examples:
 *   gfm-mdx-merge wiki/Page.md docs/page.md changes.diff
 *   git diff HEAD~1 -- wiki/Page.md | gfm-mdx-merge wiki/Page.md docs/page.md --diff-stdin
 */

import fs from 'fs/promises';
import path from 'path';
import { ThreeWayMerger } from './merger.js';

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(args) {
  const options = {
    gfmFile: null,
    mdxFile: null,
    diffFile: null,
    diffStdin: false,
    output: null,
    dryRun: false,
    verbose: false,
    quiet: false,
    strict: false,
    help: false,
  };

  let positional = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;

      case '-o':
      case '--output':
        options.output = args[++i];
        break;

      case '--diff-stdin':
        options.diffStdin = true;
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

      case '--strict':
        options.strict = true;
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        // Positional arguments
        if (positional === 0) {
          options.gfmFile = arg;
        } else if (positional === 1) {
          options.mdxFile = arg;
        } else if (positional === 2) {
          options.diffFile = arg;
        }
        positional++;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
GFM-MDX Three-Way Merge Tool

Applies Git diffs intended for GFM files to their corresponding MDX files,
transforming the changes from GFM to MDX format.

USAGE:
  gfm-mdx-merge <gfm-file> <mdx-file> <diff-file> [options]
  gfm-mdx-merge <gfm-file> <mdx-file> --diff-stdin [options]

ARGUMENTS:
  <gfm-file>    Original GFM markdown file
  <mdx-file>    Corresponding MDX file (may differ from GFM)
  <diff-file>   Git diff file to apply

OPTIONS:
  -h, --help        Show this help message
  -o, --output      Output file (default: overwrite mdx-file, or stdout with --dry-run)
  --diff-stdin      Read diff from stdin instead of file
  --dry-run         Preview changes without writing
  -v, --verbose     Show detailed merge information
  -q, --quiet       Suppress non-error output
  --strict          Fail on fuzzy matches (require high confidence)

EXAMPLES:
  # Apply a diff file
  gfm-mdx-merge wiki/GPS.md docs/gps.md gps-update.diff

  # Pipe diff from git
  git diff HEAD~1 -- wiki/GPS.md | gfm-mdx-merge wiki/GPS.md docs/gps.md --diff-stdin

  # Preview changes
  gfm-mdx-merge wiki/GPS.md docs/gps.md changes.diff --dry-run --verbose

  # Output to different file
  gfm-mdx-merge wiki/GPS.md docs/gps.md changes.diff -o docs/gps-merged.md

HOW IT WORKS:
  1. Parses the diff to extract hunks (changes)
  2. For each hunk, finds the corresponding region in the MDX file
     using fuzzy matching (accounts for GFM→MDX transformations)
  3. Transforms the additions from GFM to MDX format
  4. Applies the transformed changes to the MDX file

MATCHING:
  The tool uses normalized comparison to match GFM regions to MDX regions:
  - Handles HTML entities (&lt; ↔ <)
  - Handles MDX escapes (\\< ↔ <)
  - Handles attribute differences (class ↔ className)
  - Uses fuzzy matching for imperfect matches

TRANSFORMATIONS:
  When applying additions:
  - Escapes < and { for MDX compatibility
  - Converts void elements to self-closing (<br> → <br />)
  - Converts class to className
  - Detects and matches existing MDX style (entities vs escapes)
`);
}

// =============================================================================
// Read from stdin
// =============================================================================

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  // Validate arguments
  if (!options.gfmFile || !options.mdxFile) {
    console.error('Error: Both GFM and MDX files are required');
    process.exit(1);
  }

  if (!options.diffFile && !options.diffStdin) {
    console.error('Error: Diff file or --diff-stdin is required');
    process.exit(1);
  }

  try {
    // Read input files
    const gfmContent = await fs.readFile(options.gfmFile, 'utf-8');
    const mdxContent = await fs.readFile(options.mdxFile, 'utf-8');
    
    let diffContent;
    if (options.diffStdin) {
      diffContent = await readStdin();
    } else {
      diffContent = await fs.readFile(options.diffFile, 'utf-8');
    }

    // Perform merge
    const merger = new ThreeWayMerger({
      verbose: options.verbose,
      allowFuzzyApply: !options.strict,
      minMatchScore: options.strict ? 0.9 : 0.7
    });

    const result = merger.merge(gfmContent, mdxContent, diffContent);
    const summary = merger.getSummary();

    // Output results
    if (options.verbose) {
      console.log('\n' + '═'.repeat(60));
      console.log('MERGE SUMMARY');
      console.log('═'.repeat(60));
      console.log(`Hunks applied: ${summary.hunksApplied}`);
      console.log(`Conflicts: ${summary.hunksConflicted}`);
      console.log(`Warnings: ${summary.warningsCount}`);
      
      if (summary.details.applied.length > 0) {
        console.log('\nApplied hunks:');
        for (const h of summary.details.applied) {
          console.log(`  ✅ Line ${h.line} (score: ${h.score?.toFixed(2) || 'N/A'}, transformed: ${h.transformed})`);
        }
      }

      if (summary.details.conflicts.length > 0) {
        console.log('\nConflicts:');
        for (const c of summary.details.conflicts) {
          console.log(`  ❌ Line ${c.line}: ${c.reason}`);
        }
      }

      if (summary.details.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const w of summary.details.warnings) {
          console.log(`  ⚠️  ${w.message}`);
        }
      }
      console.log('');
    }

    // Handle output
    if (options.dryRun) {
      if (!options.quiet) {
        console.log('--- DRY RUN - Changes not written ---\n');
      }
      process.stdout.write(result.content);
    } else {
      const outputPath = options.output || options.mdxFile;
      await fs.writeFile(outputPath, result.content, 'utf-8');
      
      if (!options.quiet) {
        if (result.success) {
          console.log(`✅ Merged successfully: ${outputPath}`);
          console.log(`   ${summary.hunksApplied} hunk(s) applied`);
        } else {
          console.log(`⚠️  Merged with conflicts: ${outputPath}`);
          console.log(`   ${summary.hunksApplied} applied, ${summary.hunksConflicted} conflicts`);
        }
      }
    }

    // Exit code based on success
    process.exit(result.success ? 0 : 1);

  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (options.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
