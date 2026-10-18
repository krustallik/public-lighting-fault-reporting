import { afterEach, describe, expect, it, vi } from 'vitest';
import adminViteConfig from '../../apps/admin/vite.config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('admin local UAT Vite configuration', () => {
  it('binds to loopback when local UAT is enabled without relying on a CLI host override', () => {
    vi.stubEnv('LOCAL_UAT_MODE', 'true');
    const config = adminViteConfig({ command: 'serve', mode: 'development', isSsrBuild: false, isPreview: false });
    expect(config.server?.host).toBe('127.0.0.1');
  });
});
