/**
 * GFM-MDX Three-Way Merge Tool
 * 
 * Applies GFM diffs to corresponding MDX files, transforming changes
 * from GFM to MDX format while handling format differences.
 */

export { ThreeWayMerger, mergeGfmToMdx, canApplyDiff } from './merger.js';
export { DiffParser, HunkTransformer } from './diff-parser.js';
export { FuzzyMatcher } from './fuzzy-matcher.js';
export { TextNormalizer, LineNormalizer, HTML_ENTITIES, MDX_ESCAPES } from './normalizer.js';
export { GfmToMdxTransformer, MdxToGfmTransformer, VOID_ELEMENTS } from './transformer.js';

export { ThreeWayMerger as default } from './merger.js';
