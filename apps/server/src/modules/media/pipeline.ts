import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../../http/app-error';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const VARIANT_WIDTHS = [320, 640, 960] as const;
export type VariantWidth = (typeof VARIANT_WIDTHS)[number];
const MAX_INPUT_PIXELS = 40_000_000;

/** Magic-byte sniffing: the declared content type is never trusted. */
export function sniffImage(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface ProcessedImage {
  sha256: string;
  width: number;
  height: number;
  variants: Map<VariantWidth, Buffer>;
}

/**
 * Decode → orient → attention-crop to a 3:4 portrait → re-encode WebP variants.
 * Re-encoding drops all metadata (EXIF/GPS/ICC comments); only pixels survive.
 * Inputs are PNG/JPEG/WebP of at most 2 MiB (or `maxBytes` for trusted
 * operator imports, which are still fully decoded and re-encoded).
 */
export async function processPortrait(
  input: Buffer,
  options: { maxBytes?: number } = {},
): Promise<ProcessedImage> {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  if (input.length === 0 || input.length > maxBytes) {
    throw new AppError('VALIDATION_FAILED', 'Images must be PNG, JPEG or WebP up to 2 MiB.', {
      reason: 'IMAGE_SIZE',
    });
  }
  if (!sniffImage(input)) {
    throw new AppError('VALIDATION_FAILED', 'Images must be PNG, JPEG or WebP up to 2 MiB.', {
      reason: 'IMAGE_TYPE',
    });
  }
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
  } catch {
    throw new AppError('VALIDATION_FAILED', 'This image could not be decoded.', {
      reason: 'IMAGE_DECODE',
    });
  }
  if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64) {
    throw new AppError('VALIDATION_FAILED', 'Images must be at least 64×64 pixels.', {
      reason: 'IMAGE_SMALL',
    });
  }
  const variants = new Map<VariantWidth, Buffer>();
  for (const width of VARIANT_WIDTHS) {
    const height = Math.round((width * 4) / 3);
    const out = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      pages: 1,
    })
      .rotate() // apply EXIF orientation before metadata is discarded
      .resize(width, height, {
        fit: 'cover',
        position: sharp.strategy.attention,
        withoutEnlargement: false,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    variants.set(width, out);
  }
  const largest = variants.get(960) as Buffer;
  return {
    sha256: createHash('sha256').update(largest).digest('hex'),
    width: 960,
    height: 1280,
    variants,
  };
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Original illustrated portrait for fictional demo players (ADR-017 route B):
 * a deterministic, stylised figure in the fictional team's kit. Never used for
 * real players — they get real (freely licensed or licensed) photos.
 */
export function generatedPortraitSvg(
  seedKey: string,
  kit: readonly [string, string],
  initials: string,
): string {
  const h = hash32(seedKey);
  const skins = ['#8D5524', '#A0673E', '#C68642', '#E0AC69', '#F1C27D', '#6B4423'];
  const hairs = ['#1B1B1B', '#3B2219', '#5A3825', '#2C1B10', '#4A4A4A'];
  const skin = skins[h % skins.length] ?? '#C68642';
  const hair = hairs[(h >>> 4) % hairs.length] ?? '#1B1B1B';
  const bg = ['#0F2235', '#14263B', '#1A2C44', '#0D1B2A'][(h >>> 8) % 4] ?? '#0F2235';
  const tilt = ((h >>> 12) % 7) - 3;
  const capped = ((h >>> 16) & 1) === 1;
  const safeInitials = initials.replace(/[^A-Z]/g, '').slice(0, 3);
  const [primary, secondary] = kit;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1280" viewBox="0 0 960 1280">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#05090F"/></linearGradient>
    <linearGradient id="kit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient>
  </defs>
  <rect width="960" height="1280" fill="url(#bg)"/>
  <circle cx="480" cy="520" r="420" fill="${primary}" opacity="0.12"/>
  <g transform="rotate(${tilt} 480 640)">
    <path d="M150 1280 C170 960 300 860 480 860 C660 860 790 960 810 1280 Z" fill="url(#kit)"/>
    <path d="M400 860 L480 960 L560 860 Z" fill="${secondary}" opacity="0.9"/>
    <rect x="430" y="740" width="100" height="140" rx="40" fill="${skin}"/>
    <ellipse cx="480" cy="560" rx="170" ry="210" fill="${skin}"/>
    ${
      capped
        ? `<path d="M300 520 C300 330 660 330 660 520 L700 540 C690 560 270 560 260 540 Z" fill="${primary}"/><rect x="270" y="520" width="420" height="34" rx="16" fill="${secondary}"/>`
        : `<path d="M310 540 C290 330 670 330 650 540 C640 450 560 410 480 410 C400 410 320 450 310 540 Z" fill="${hair}"/>`
    }
    <ellipse cx="420" cy="590" rx="16" ry="12" fill="#1B1B1B"/>
    <ellipse cx="540" cy="590" rx="16" ry="12" fill="#1B1B1B"/>
    <path d="M430 680 Q480 712 530 680" stroke="#5A2E1A" stroke-width="10" fill="none" stroke-linecap="round"/>
  </g>
  <text x="480" y="1180" text-anchor="middle" font-family="sans-serif" font-size="120" font-weight="700" fill="${secondary}" opacity="0.9">${safeInitials}</text>
  <text x="40" y="70" font-family="sans-serif" font-size="40" font-weight="700" fill="#FFFFFF" opacity="0.55">DEMO</text>
</svg>`;
}

/** Render the generated 3:4 SVG portrait straight to the WebP variants (no crop needed). */
export async function renderGeneratedPortrait(svg: string): Promise<ProcessedImage> {
  const source = Buffer.from(svg);
  const variants = new Map<VariantWidth, Buffer>();
  for (const width of VARIANT_WIDTHS) {
    variants.set(
      width,
      await sharp(source, { density: Math.round((72 * width) / 960) || 24 })
        .resize(width, Math.round((width * 4) / 3))
        .webp({ quality: 80, effort: 2 })
        .toBuffer(),
    );
  }
  const largest = variants.get(960) as Buffer;
  return {
    sha256: createHash('sha256').update(largest).digest('hex'),
    width: 960,
    height: 1280,
    variants,
  };
}
