export function stableSort<T>(arr: T[], cmp: (a: T, b: T) => number): T[] {
  const withIdx = arr.map((v, i) => ({ v, i }));
  withIdx.sort((aa, bb) => {
    const c = cmp(aa.v, bb.v);
    if (c !== 0) return c;
    return aa.i - bb.i;
  });
  return withIdx.map((x) => x.v);
}

