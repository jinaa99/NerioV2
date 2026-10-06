import 'server-only';
import { eraseLettering, type Balloon, type PageRaster } from './bubbles';

/**
 * Removing the original lettering before the translation is lettered in. Implementations only touch the pixels of
 * the regions they are given and never the stored original image (they work on a decoded copy).
 */
export type RemovalOutcome = 'clean' | 'needs_review';
export type RemovalRegion = { id: string; balloon: Balloon };

export interface TextRemovalProvider {
  readonly name: string;
  /** Erase lettering in place on `canvas`; report per region whether the result is safe without a human look. */
  remove(canvas: PageRaster, regions: RemovalRegion[]): Map<string, RemovalOutcome>;
}

/**
 * Text inside a closed balloon or on a flat background is repainted with that background colour, which is exact.
 * Text over detailed artwork can only be covered with the dominant surrounding colour, so it is flagged for review.
 */
export function removalSafety(balloon: Balloon): RemovalOutcome {
  return balloon.enclosed || balloon.flat ? 'clean' : 'needs_review';
}

/** Deterministic local removal: flood-filled balloon interiors and flat backgrounds are repainted, nothing generated. */
export class LocalFillTextRemoval implements TextRemovalProvider {
  readonly name = 'local-fill';
  remove(canvas: PageRaster, regions: RemovalRegion[]) {
    eraseLettering(canvas, regions.map(region => region.balloon));
    return new Map(regions.map(region => [region.id, removalSafety(region.balloon)] as const));
  }
}

export function getTextRemovalProvider(): TextRemovalProvider {
  return new LocalFillTextRemoval();
}
