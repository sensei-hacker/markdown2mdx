/**
 * Transform: Image URL Rewriting
 *
 * Rewrites GitHub-hosted image URLs to local /img/content/... paths.
 * Also rewrites wiki-relative images/X.jpg paths to /img/content/X.jpg.
 *
 * Requires ctx.imageRewriter (an ImageRewriter instance) to be provided.
 * The ImageRewriter is created externally (by cli.js) because it accumulates
 * a download manifest across all files in a conversion run.
 *
 * Interface: transform(content, ctx?) => string
 * ctx: { imageRewriter? }
 *
 * Also exports: ImageRewriter  (used by cli.js)
 */

import path from 'path';
import fs from 'fs';

// =============================================================================
// Transform function
// =============================================================================

/**
 * Rewrite image URLs.
 *
 * @param {string} content
 * @param {object} ctx
 * @param {ImageRewriter} [ctx.imageRewriter]
 * @returns {string}
 */
export function transform(content, ctx = {}) {
  if (!ctx.imageRewriter) return content;
  return ctx.imageRewriter.rewriteAll(content);
}

// =============================================================================
// Constants
// =============================================================================

// URL patterns that should be rewritten to local paths
const GITHUB_IMAGE_PATTERNS = [
  // raw.githubusercontent.com/iNavFlight/... (firmware repo assets)
  /^https?:\/\/raw\.githubusercontent\.com\/iNavFlight\/([^/]+)\/[^/]+\/docs\/(.+)$/,
  // GitHub wiki assets: github.com/iNavFlight/inav/wiki/assets/...
  /^https?:\/\/github\.com\/iNavFlight\/[^/]+\/wiki\/([^?#]+)$/,
];

// Known third-party image hosts to keep as-is (not downloadable automatically)
const EXTERNAL_HOSTS_KEEP = [
  'imgur.com',
  'postimg.org',
  'hostingkartinok.com',
  'img.youtube.com',
  'user-images.githubusercontent.com', // user-uploaded, repo-independent
];

// =============================================================================
// ImageRewriter Class
// =============================================================================

export class ImageRewriter {
  /**
   * @param {object} options
   * @param {string} options.imgBaseUrl  Base URL for local images (default: /img/content)
   * @param {string} [options.staticDir]  Path to static/ directory for downloading images
   * @param {string} [options.imgSubdir]  Subdirectory under static/img/ (default: content)
   */
  constructor(options = {}) {
    this.imgBaseUrl = options.imgBaseUrl || '/img/content';
    this.staticDir = options.staticDir || null;
    this.imgSubdir = options.imgSubdir || 'content';
    this.imageManifest = []; // Track images that need to be downloaded
  }

  /**
   * Determine if a URL should be rewritten to a local path.
   * Only rewrites iNavFlight GitHub-hosted assets.
   */
  shouldRewrite(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;

      // Keep known external hosts as-is
      if (EXTERNAL_HOSTS_KEEP.some(h => host.endsWith(h))) return false;

      // Rewrite iNavFlight GitHub raw content
      if (host === 'raw.githubusercontent.com' && parsed.pathname.includes('/iNavFlight/')) return true;

      // Rewrite GitHub cloud-hosted images (older wiki uploads used this domain)
      if (host === 'cloud.githubusercontent.com') return true;

      // Rewrite iNavFlight wiki assets
      if ((host === 'github.com') && parsed.pathname.includes('/iNavFlight/') && parsed.pathname.includes('/wiki/')) return true;

      // Rewrite quadmeup.com (hosts INAV release banner images and tutorials)
      if (host === 'quadmeup.com') return true;

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Extract a local filename from a GitHub image URL.
   */
  extractFilename(url) {
    try {
      const parsed = new URL(url);
      const basename = path.basename(parsed.pathname);
      return decodeURIComponent(basename);
    } catch {
      return null;
    }
  }

  /**
   * Rewrite a single image URL to a local path.
   * Records the URL in imageManifest for later downloading.
   *
   * @param {string} url  The original image URL
   * @returns {string}  The local /img/content/... path, or original URL if not rewritten
   */
  rewriteUrl(url) {
    if (!this.shouldRewrite(url)) return url;

    const filename = this.extractFilename(url);
    if (!filename) return url;

    const localPath = `${this.imgBaseUrl}/${filename}`;

    // Record for manifest
    this.imageManifest.push({ url, localPath, filename });

    return localPath;
  }

  /**
   * Rewrite wiki-relative images/X.jpg paths to /img/content/X.jpg.
   * These are images stored in the wiki git repo's images/ directory.
   */
  rewriteWikiRelativeUrl(url) {
    if (url.startsWith('images/')) {
      const filename = url.slice('images/'.length);
      return `${this.imgBaseUrl}/${filename}`;
    }
    return null;
  }

  /**
   * Rewrite all image URLs in markdown content.
   * Handles both:
   *   ![alt](url) - standard markdown images
   *   <img src="url"> - HTML images
   * Also rewrites wiki-relative images/X.jpg paths.
   */
  rewriteAll(content) {
    // Standard markdown images: ![alt](url)
    content = content.replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (match, alt, url) => {
        const wikiRelative = this.rewriteWikiRelativeUrl(url);
        if (wikiRelative) return `![${alt}](${wikiRelative})`;
        const rewritten = this.rewriteUrl(url);
        if (rewritten === url) return match;
        return `![${alt}](${rewritten})`;
      }
    );

    // HTML img tags: <img src="url" ...>
    content = content.replace(
      /<img\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi,
      (match, before, url, after) => {
        const wikiRelative = this.rewriteWikiRelativeUrl(url);
        if (wikiRelative) return `<img${before}src="${wikiRelative}"${after}>`;
        const rewritten = this.rewriteUrl(url);
        if (rewritten === url) return match;
        return `<img${before}src="${rewritten}"${after}>`;
      }
    );

    return content;
  }

  /**
   * Download all images in the manifest to the static directory.
   * Requires staticDir to be set and Node.js fetch API (Node 18+).
   *
   * @returns {Promise<{downloaded: string[], failed: string[]}>}
   */
  async downloadImages() {
    if (!this.staticDir) throw new Error('staticDir not set');

    const imgDir = path.join(this.staticDir, 'img', this.imgSubdir);
    fs.mkdirSync(imgDir, { recursive: true });

    const downloaded = [];
    const failed = [];

    for (const { url, filename } of this.imageManifest) {
      const destPath = path.join(imgDir, filename);

      // Skip if already downloaded
      if (fs.existsSync(destPath)) {
        downloaded.push(filename);
        continue;
      }

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(destPath, Buffer.from(buffer));
        downloaded.push(filename);
      } catch (err) {
        failed.push({ filename, url, error: err.message });
      }
    }

    return { downloaded, failed };
  }

  /** Get the manifest of images that were rewritten (need downloading). */
  getManifest() {
    return [...this.imageManifest];
  }

  /** Write the manifest to a JSON file. */
  writeManifest(outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(this.imageManifest, null, 2) + '\n');
  }
}

export default transform;
