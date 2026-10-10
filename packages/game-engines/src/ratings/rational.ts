/**
 * Exact non-negative rationals over bigint so every comparison in the rating
 * model is reproducible bit-for-bit (rules §3.2.1: never compare rounded floats).
 */
export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

export function rat(n: bigint | number, d: bigint | number = 1n): Rational {
  const nn = BigInt(n);
  const dd = BigInt(d);
  if (dd === 0n) throw new Error('zero denominator');
  return dd < 0n ? { n: -nn, d: -dd } : { n: nn, d: dd };
}

export function cmp(a: Rational, b: Rational): number {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function neg(a: Rational): Rational {
  return { n: -a.n, d: a.d };
}

/**
 * Exposure shrinkage toward a cohort prior written as counts:
 * x = num/den with exposure `den`; prior mu = priorNum/priorDen;
 * shrunk = (den·x + k·mu)/(den + k) = (num·priorDen + k·priorNum) / (priorDen·(den + k)).
 */
export function shrink(
  num: bigint,
  den: bigint,
  priorNum: bigint,
  priorDen: bigint,
  k: bigint,
): Rational {
  return rat(num * priorDen + k * priorNum, priorDen * (den + k));
}

/** Integer division rounded half up for non-negative bigint operands. */
export function roundDiv(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/** Integer square root rounded to nearest. */
export function isqrtRound(value: bigint): bigint {
  if (value < 0n) throw new Error('negative sqrt');
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  // x = floor(sqrt(value)); round to nearest
  return value - x * x > x ? x + 1n : x;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}

function reduce(n: bigint, d: bigint): Rational {
  const g = gcd(n, d);
  return rat(n / g, d / g);
}

export function add(a: Rational, b: Rational): Rational {
  return reduce(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function mul(a: Rational, b: Rational): Rational {
  return reduce(a.n * b.n, a.d * b.d);
}

export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new Error('division by zero');
  return reduce(a.n * b.d, a.d * b.n);
}

/** Generic exposure shrinkage (n·x + k·mu)/(n + k) with rational exposure n. */
export function shrinkTo(x: Rational, n: Rational, mu: Rational, k: bigint): Rational {
  const kk = rat(k);
  return div(add(mul(n, x), mul(kk, mu)), add(n, kk));
}
