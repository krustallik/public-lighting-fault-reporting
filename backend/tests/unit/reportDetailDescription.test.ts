import { describe, expect, it } from 'vitest';
import { appendInteractiveMapDetailSuffix, INTERACTIVE_MAP_DETAIL_SUFFIX } from '../../src/utils/reportDetailDescription.js';

describe('server-side interactive map detail description', () => {
  it('adds the attribution for empty input, preserves user text, and never duplicates an existing suffix', () => {
    expect(appendInteractiveMapDetailSuffix()).toBe(INTERACTIVE_MAP_DETAIL_SUFFIX);
    expect(appendInteractiveMapDetailSuffix('  ')).toBe(INTERACTIVE_MAP_DETAIL_SUFFIX);
    expect(appendInteractiveMapDetailSuffix(' Lamp at the corner ')).toBe(`Lamp at the corner\n\n${INTERACTIVE_MAP_DETAIL_SUFFIX}`);
    expect(appendInteractiveMapDetailSuffix(` User note \n\n${INTERACTIVE_MAP_DETAIL_SUFFIX} `)).toBe(`User note \n\n${INTERACTIVE_MAP_DETAIL_SUFFIX}`);
    expect(appendInteractiveMapDetailSuffix(INTERACTIVE_MAP_DETAIL_SUFFIX)).toBe(INTERACTIVE_MAP_DETAIL_SUFFIX);
  });
});
