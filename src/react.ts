import { useEffect } from 'react';
import { glideScroll, type GlideScrollOptions } from './index.js';

export type { GlideScrollOptions };

/**
 * Turns on glide scrolling while mounted, and off when unmounted. Put it once near the root of the
 * app. Renders nothing. Options are read once, when it mounts.
 *
 * @example
 * import { GlideScroll } from 'glide-scroll/react';
 *
 * <GlideScroll catchUpMs={160} />
 */
export function GlideScroll({ catchUpMs, storageKey }: GlideScrollOptions = {}): null {
  useEffect(
    () => glideScroll({ catchUpMs, storageKey }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options are read once, on mount
    [],
  );
  return null;
}
