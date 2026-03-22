#!/usr/bin/env node
/**
 * combine-release-notes.js
 *
 * Combines multiple GFM release notes files for a given major version into a
 * single tabbed MDX page.  Tabs are ordered newest-first; the first tab
 * (newest) is shown by default.
 *
 * Usage:
 *   node combine-release-notes.js --major <N> --output <file> <gfm1.md> <gfm2.md> ...
 *
 * Options:
 *   --major <N>         Major version number (e.g. 7)  → title "INAV 7 Release Notes"
 *   --output <file>     Write to file (default: stdout)
 *   --sidebar-pos <n>   sidebar_position value (default: 2)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { GfmToMdxConverter } from './converter.js';
import { extractFrontMatter } from './transforms/front-matter.js';
import { ImageRewriter } from './transforms/images.js';

// ---------------------------------------------------------------------------
// Version parsing / sorting
// ---------------------------------------------------------------------------

/**
 * Parse a semver-ish string like "7.1.0" into [7, 1, 0].
 * Non-numeric parts become 0.
 */
function parseVersion(str) {
  return str.split('.').map(n => parseInt(n, 10) || 0);
}

/**
 * Compare two version strings for sort().  Returns negative if a < b.
 */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0); // descending (newest first)
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Extract the version string from a release-notes filename stem.
 * e.g. "7.1.0-Release-Notes" → "7.1.0"
 *      "7.0.0-release-notes" → "7.0.0"
 */
function versionFromStem(stem) {
  const m = stem.match(/^(\d+\.\d+[\d.]*)[-\s]/);
  return m ? m[1] : stem;
}

// ---------------------------------------------------------------------------
// Main combiner
// ---------------------------------------------------------------------------

/**
 * Convert a GFM release notes body to MDX (no front matter).
 */
function convertBody(gfmContent, converter) {
  const { body } = extractFrontMatter(gfmContent);
  // Use a placeholder stem so the converter doesn't add front matter based on it
  const { content } = converter.convert(body, {});
  // Strip any front matter the converter may have added (shouldn't with addFrontMatter:false)
  const { body: mdxBody } = extractFrontMatter(content);
  return mdxBody.trim();
}

/**
 * Build the combined tabbed MDX string.
 *
 * @param {Array<{version: string, gfmPath: string}>} releases  Sorted newest-first
 * @param {object} opts
 * @param {string|number} opts.major           Major version number
 * @param {number}        [opts.sidebarPos]    sidebar_position (default: 2)
 * @param {ImageRewriter} [opts.imageRewriter] If provided, image URLs are rewritten
 * @returns {string}
 */
export function combineReleaseNotes(releases, opts = {}) {
  const major = opts.major;
  const sidebarPos = opts.sidebarPos ?? 2;

  const converter = new GfmToMdxConverter({
    addFrontMatter: false,
    convertAdmonitions: true,
    escapeJsxChars: true,
    fixSelfClosingTags: true,
    stripTrailingWhitespace: true,
    rewriteImages: !!opts.imageRewriter,
  });
  if (opts.imageRewriter) {
    converter.setImageRewriter(opts.imageRewriter);
  }

  const tabs = releases.map((rel, i) => ({
    version: rel.version,
    content: convertBody(readFileSync(rel.gfmPath, 'utf-8'), converter),
    isDefault: i === 0, // newest (first) is default
  }));

  const parts = [
    '---',
    `title: "INAV ${major} Release Notes"`,
    `sidebar_position: ${sidebarPos}`,
    '---',
    '',
    'import Tabs from "@theme/Tabs";',
    'import TabItem from "@theme/TabItem";',
    '',
    '<Tabs>',
  ];

  for (const tab of tabs) {
    const defaultAttr = tab.isDefault ? ' default' : '';
    parts.push(`<TabItem value="${tab.version}" label="${tab.version}"${defaultAttr}>`);
    parts.push('');
    parts.push(tab.content);
    parts.push('');
    parts.push('</TabItem>');
    parts.push('');
  }

  parts.push('</Tabs>');
  parts.push('');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { major: null, output: null, sidebarPos: 2, staticDir: null, files: [] };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--major') { opts.major = args[++i]; }
    else if (args[i] === '--output') { opts.output = args[++i]; }
    else if (args[i] === '--sidebar-pos') { opts.sidebarPos = parseInt(args[++i], 10); }
    else if (args[i] === '--static-dir') { opts.staticDir = args[++i]; }
    else { opts.files.push(args[i]); }
  }
  return opts;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const opts = parseArgs(process.argv);

  if (!opts.major || opts.files.length === 0) {
    console.error('Usage: combine-release-notes.js --major <N> [--output <file>] [--static-dir <dir>] <gfm...>');
    process.exit(1);
  }

  // Build release list: extract version from filename, sort newest-first
  const releases = opts.files
    .map(f => ({ version: versionFromStem(basename(f, '.md')), gfmPath: f }))
    .sort((a, b) => compareVersions(a.version, b.version));

  const imageRewriter = opts.staticDir
    ? new ImageRewriter({ staticDir: opts.staticDir })
    : null;

  const result = combineReleaseNotes(releases, {
    major: opts.major,
    sidebarPos: opts.sidebarPos,
    imageRewriter,
  });

  if (opts.output) {
    writeFileSync(opts.output, result, 'utf-8');
    console.error(`  Wrote: ${opts.output}`);
  } else {
    process.stdout.write(result);
  }

  if (imageRewriter) {
    imageRewriter.downloadImages().then(({ downloaded, failed }) => {
      if (downloaded.length) console.error(`  Downloaded ${downloaded.length} image(s)`);
      if (failed.length) {
        console.error(`  Failed to download ${failed.length} image(s):`);
        for (const f of failed) console.error(`    ${f.url}: ${f.error}`);
      }
    });
  }
}
