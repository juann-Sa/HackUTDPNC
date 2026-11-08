// Deterministic random numbers for the Monte Carlo (spec §6).
// xoshiro128** seeded by splitmix32: the same seed always gives the same forecast,
// which is what makes common random numbers (CRN) across scenarios possible.

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    let s = seed >>> 0;
    const split = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = split();
    this.b = split();
    this.c = split();
    this.d = split();
  }

  /** uint32 */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.b << 9) >>> 0;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result;
  }

  /** Uniform on the open interval (0, 1). */
  uniform(): number {
    return (this.next() + 0.5) / 4294967296;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Hash several integers into one 32-bit seed (customer, path pair, ...). */
export function seedOf(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Inverse standard-normal CDF (Acklam's rational approximation, |rel err| < 1.2e-9).
 * Using the inverse CDF (not Box-Muller) makes antithetic pairs exact: Φ⁻¹(1−u) = −Φ⁻¹(u).
 */
export function invNorm(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -invNorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * A fixed-length "tape" of uniforms for one antithetic pair. Path A reads u, path B reads 1−u.
 * Every scenario reads the tape in the same order, so differences between scenarios come from
 * the scenario, not from the random draws (common random numbers).
 * `keep` uniforms are shared unflipped by both paths (used for chi-square scale draws).
 */
export class Tape {
  readonly flip: Float64Array;
  readonly keep: Float64Array;
  constructor(seed: number, nFlip: number, nKeep: number) {
    const r = new Rng(seed);
    this.flip = new Float64Array(nFlip);
    this.keep = new Float64Array(nKeep);
    for (let i = 0; i < nFlip; i++) this.flip[i] = r.uniform();
    for (let i = 0; i < nKeep; i++) this.keep[i] = r.uniform();
  }
}

/** Reader over a tape for one side of the pair (antithetic = true reads 1−u). */
export class Draws {
  private i = 0;
  private j = 0;
  constructor(private readonly tape: Tape, private readonly antithetic: boolean) {}
  uniform(): number {
    const u = this.tape.flip[this.i++];
    return this.antithetic ? 1 - u : u;
  }
  normal(): number {
    return invNorm(this.uniform());
  }
  private keepNormal(): number {
    return invNorm(this.tape.keep[this.j++]);
  }
  /** Student-t with ν degrees of freedom, scaled to unit variance. Antithetic pair gives ±t. */
  studentT(nu: number): number {
    const z = this.normal();
    let v = 0;
    for (let k = 0; k < nu; k++) {
      const g = this.keepNormal();
      v += g * g;
    }
    return (z / Math.sqrt(v / nu)) * Math.sqrt((nu - 2) / nu);
  }
}
