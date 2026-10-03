import { describe, expect, it } from 'vitest';

describe('temporary CI required-check red-path probe', () => {
  it('fails deliberately only on this ephemeral branch', () => {
    expect('intentional-red-probe').toBe('success');
  });
});
