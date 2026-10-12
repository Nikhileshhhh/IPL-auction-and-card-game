/**
 * Money is integer rupees as decimal strings (no floats). Shown in Indian units:
 * crore (1,00,00,000) and lakh (1,00,000), with the full amount for tooltips.
 */
const CRORE = 10_000_000n;
const LAKH = 100_000n;

function trimmed(whole: bigint, rest: bigint, unit: bigint): string {
  if (rest === 0n) return whole.toString();
  // Two decimals at most, never rounded up past what was paid.
  const hundredths = (rest * 100n) / unit;
  return `${whole}.${hundredths.toString().padStart(2, '0').replace(/0+$/, '')}`;
}

/** "₹18 cr", "₹4.25 cr", "₹75 lakh", "₹0". */
export function formatRupees(value: string | bigint): string {
  const r = typeof value === 'bigint' ? value : BigInt(value);
  if (r >= CRORE) return `₹${trimmed(r / CRORE, r % CRORE, CRORE)} cr`;
  if (r >= LAKH) return `₹${trimmed(r / LAKH, r % LAKH, LAKH)} lakh`;
  return `₹${r.toString()}`;
}

/** "₹12,00,00,000" — Indian digit grouping of the exact amount. */
export function fullRupees(value: string | bigint): string {
  const digits = (typeof value === 'bigint' ? value : BigInt(value)).toString();
  if (digits.length <= 3) return `₹${digits}`;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${rest},${last3}`;
}

/** Whole crore from an input field → rupees string ("" for an empty field). */
export function croreToRupees(crore: string): string | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(crore.trim());
  if (!m) return null;
  const lakhs = BigInt(m[1] ?? '0') * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return (lakhs * LAKH).toString();
}

export function rupeesToCrore(rupees: string): string {
  const lakhs = BigInt(rupees) / LAKH;
  const whole = lakhs / 100n;
  const rest = lakhs % 100n;
  return rest === 0n
    ? whole.toString()
    : `${whole}.${rest.toString().padStart(2, '0').replace(/0+$/, '')}`;
}
