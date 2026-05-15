// Matches: name{l1="v1",l2="v2"} 12.3   OR   name 12.3
const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?[0-9.eE+-]+|\+Inf|-Inf|NaN)\s*$/;

const flattenLabels = (raw: string | undefined): string => {
  if (!raw) return '';
  const inner = raw.slice(1, -1);
  if (!inner) return '';
  const parts = inner.split(',').map((p) => p.trim().replace(/="([^"]*)"/, '=$1'));
  return `{${parts.join(',')}}`;
};

export const parsePromText = (text: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = LINE.exec(t);
    if (!m) continue;
    const [, name, labels, value] = m;
    if (value === undefined) continue;
    let n: number;
    if (value === '+Inf') n = Infinity;
    else if (value === '-Inf') n = -Infinity;
    else if (value === 'NaN') n = NaN;
    else n = Number(value);
    out[`${name}${flattenLabels(labels)}`] = n;
  }
  return out;
};

export const filterByPrefix = (
  gauges: Record<string, number>,
  prefixes: string[],
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(gauges)) {
    const base = k.split('{', 1)[0]!;
    if (prefixes.some((p) => base === p || base.startsWith(p + '_') || base.startsWith(p))) {
      out[k] = v;
    }
  }
  return out;
};
