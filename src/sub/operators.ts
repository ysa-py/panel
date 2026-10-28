/**
 * Operator names are optional display labels, not claims about ISP-specific DPI.
 * The old upstream table described itself as ported from other projects; it is
 * intentionally not included here. Fragment values must be chosen explicitly by
 * the operator and are not inferred from a user's ISP or location.
 */
export interface FragPreset {
  packets: 'tlshello';
  length: string;
  interval: string;
}
export interface Operator {
  key: string;
  fa: string;
  en: string;
  fp: string;
  frag: FragPreset | null;
  ports: number[];
  asns: number[];
}

export const DEFAULT_FP = 'chrome';
/** Informational Cloudflare HTTPS ports; actual routes/plans may vary. */
export const TLS_PORTS = [443, 2053, 2083, 2087, 8443];
export const OPERATORS: Operator[] = [
  { key: 'mci', fa: 'همراه اول', en: 'MCI (Hamrah-e Aval)' },
  { key: 'irancell', fa: 'ایرانسل', en: 'Irancell' },
  { key: 'rightel', fa: 'رایتل', en: 'Rightel' },
  { key: 'shatel', fa: 'شاتل', en: 'Shatel' },
  { key: 'tci', fa: 'مخابرات ایران', en: 'TCI' },
].map((label) => ({ ...label, fp: DEFAULT_FP, frag: null, ports: [...TLS_PORTS], asns: [] }));

export function resolveOp(key?: string | null): Operator | null {
  const normalized = (key || '').trim().toLowerCase();
  return OPERATORS.find((item) => item.key === normalized) ?? null;
}
export function operatorLabel(op: Operator | null, lang: 'fa' | 'en' = 'fa'): string {
  return op ? (lang === 'fa' ? op.fa : op.en) : lang === 'fa' ? 'خودکار' : 'Auto';
}
export interface SubOpts {
  opKey?: string;
  ech?: boolean;
  /** Explicitly supplied values; Xray output only, effectiveness unverified. */
  fragment?: FragPreset;
}
function validRange(value: string | null | undefined, max: number): string | undefined {
  const match = /^(\d{1,3})-(\d{1,3})$/.exec(value || '');
  if (!match) return undefined;
  const low = Number(match[1]), high = Number(match[2]);
  return low >= 1 && high >= low && high <= max ? `${low}-${high}` : undefined;
}
export function resolveOpts(
  opKey?: string | null, ech?: string | null, fragmentLength?: string | null, fragmentInterval?: string | null,
): SubOpts {
  const length = validRange(fragmentLength, 500), interval = validRange(fragmentInterval, 30);
  return { opKey: opKey ?? undefined, ech: ech === '1' || ech === 'true',
    fragment: length && interval ? { packets: 'tlshello', length, interval } : undefined };
}
/** No unverified, ISP-specific fingerprint changes are made. */
export function fpFor(_opts: SubOpts | null | undefined): string { return DEFAULT_FP; }
export function opBranding(opts: SubOpts | null | undefined): Operator | null {
  return opts?.opKey ? resolveOp(opts.opKey) : null;
}
