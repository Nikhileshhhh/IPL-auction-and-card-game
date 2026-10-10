'use client';

import Image from 'next/image';
import { useState } from 'react';

export const SILHOUETTE = '/original-assets/silhouette.svg';

/**
 * Player portrait (ADR-017): always rendered. A failed load swaps to the
 * original silhouette with a text label and records a client metric; the
 * image is never silently omitted.
 */
export function PortraitImage({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <Image
      src={failed ? SILHOUETTE : src}
      alt={failed ? `${alt} (photo not available)` : alt}
      fill
      unoptimized
      sizes={sizes}
      priority={priority}
      data-portrait={failed ? 'fallback' : 'photo'}
      className={className ?? 'object-cover object-[center_32%]'}
      onError={() => {
        if (failed) return;
        setFailed(true);
        try {
          window.dispatchEvent(
            new CustomEvent('stumps:metric', { detail: { name: 'portrait_fallback', src } }),
          );
        } catch {
          /* metrics are best effort */
        }
      }}
    />
  );
}
