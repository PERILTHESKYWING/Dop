/** Log-gamma (Lanczos). */
export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(X > t) for X ~ Beta(a, b), by Simpson integration of the density. */
export function betaSurvival(a: number, b: number, t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const lnB = lgamma(a) + lgamma(b) - lgamma(a + b);
  const pdf = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnB));
  const n = 400;
  const h = (1 - t) / n;
  let s = pdf(t) + pdf(1 - 1e-9);
  for (let i = 1; i < n; i++) s += pdf(t + i * h) * (i % 2 ? 4 : 2);
  return Math.min(1, Math.max(0, (s * h) / 3));
}

/** Wilson score interval lower bound. */
export function wilsonLower(k: number, n: number, z = 1.64): number {
  if (n === 0) return 0;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (c - r) / d);
}

/** One-sided binomial test: P(X >= k) for X ~ Bin(n, p). */
export function binomialPValue(k: number, n: number, p: number): number {
  let total = 0;
  for (let i = k; i <= n; i++) {
    const lnC = lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1);
    total += Math.exp(lnC + i * Math.log(Math.max(p, 1e-12)) + (n - i) * Math.log(Math.max(1 - p, 1e-12)));
  }
  return Math.min(1, total);
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
