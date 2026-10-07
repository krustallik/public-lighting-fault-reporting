const EDGE_TRIM_CODE_POINTS = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
]);

/** Apply the fixed P3 identity rule: exact edge set, then NFC, preserving case and inner space. */
export function canonicalizeInventoryNumber(value: string): string {
  const points = Array.from(value);
  let start = 0;
  let end = points.length;
  while (start < end && EDGE_TRIM_CODE_POINTS.has(points[start].codePointAt(0)!)) start += 1;
  while (end > start && EDGE_TRIM_CODE_POINTS.has(points[end - 1].codePointAt(0)!)) end -= 1;
  return points.slice(start, end).join('').normalize('NFC');
}

export function isCanonicalInventoryNumber(value: string): boolean {
  return value.length > 0 && value === canonicalizeInventoryNumber(value);
}
