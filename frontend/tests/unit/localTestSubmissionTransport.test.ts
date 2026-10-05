import { describe, expect, it, vi } from 'vitest';
import { postLocalTestSubmission } from '../../src/utils/localTestSubmissionTransport';

const fetchRuntime = { mode: 'development', productionBuild: false } as const;

describe('local-test endpoint origin guard', () => {
  it.each([
    ['development localhost', 'http://localhost:5000/api', fetchRuntime, 'http://localhost:5000/api/dev/ausemio-test-submit'],
    ['development IPv4 loopback', 'http://127.0.0.1:5000/api', fetchRuntime, 'http://127.0.0.1:5000/api/dev/ausemio-test-submit'],
    ['development IPv6 loopback', 'http://[::1]:5000/api', fetchRuntime, 'http://[::1]:5000/api/dev/ausemio-test-submit'],
    ['test-mode localhost', 'http://localhost:5000/api', { mode: 'test', productionBuild: false }, 'http://localhost:5000/api/dev/ausemio-test-submit'],
  ])('allows %s and posts only to the local test endpoint', async (_case, apiBase, runtime, expectedUrl) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    await postLocalTestSubmission(new FormData(), apiBase, runtime, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(expectedUrl);
  });

  it.each([
    ['production mode', 'http://localhost:5000/api', { mode: 'production', productionBuild: false }],
    ['production build', 'http://localhost:5000/api', { mode: 'development', productionBuild: true }],
    ['unsupported mode', 'http://localhost:5000/api', { mode: 'staging', productionBuild: false }],
    ['external host', 'https://example.com/api', fetchRuntime],
    ['AUSEMIO host', 'https://kosice.ausem.io/api', fetchRuntime],
    ['malformed URL', 'not a URL', fetchRuntime],
    ['ftp protocol', 'ftp://localhost:5000/api', fetchRuntime],
    ['file protocol', 'file://localhost/api', fetchRuntime],
    ['websocket protocol', 'ws://localhost:5000/api', fetchRuntime],
    ['URL credentials', 'http://user:password@localhost:5000/api', fetchRuntime],
    ['URL query', 'http://localhost:5000/api?debug=true', fetchRuntime],
    ['URL hash', 'http://localhost:5000/api#section', fetchRuntime],
  ])('classifies %s as a configuration rejection before fetch', async (_case, apiBase, runtime) => {
    const fetcher = vi.fn();

    await expect(postLocalTestSubmission(new FormData(), apiBase, runtime, fetcher))
      .rejects.toMatchObject({
        name: 'LocalTestTransportConfigurationError',
        code: 'LOCAL_TEST_TRANSPORT_CONFIG',
      });
    expect(fetcher).toHaveBeenCalledTimes(0);
  });
});
