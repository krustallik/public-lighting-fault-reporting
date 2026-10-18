import { describe, expect, it } from 'vitest';
import { assertStandardBackendEntrypoint } from '../../src/standardEntrypointGuard.js';

describe('standard backend entrypoint guard', () => {
  it('allows normal development and production entrypoints', () => {
    expect(() => assertStandardBackendEntrypoint({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertStandardBackendEntrypoint({ NODE_ENV: 'production' })).not.toThrow();
  });

  it('rejects LOCAL_UAT_MODE before normal provider-backed server modules load', () => {
    expect(() => assertStandardBackendEntrypoint({ NODE_ENV: 'development', LOCAL_UAT_MODE: 'true' }))
      .toThrow('LOCAL_UAT_MODE is reserved for the fake-provider local UAT server.');
  });
});
