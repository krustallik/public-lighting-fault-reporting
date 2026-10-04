import { describe, expect, it, vi } from 'vitest';
import { postLocalTestSubmission } from '../../src/utils/localTestSubmissionTransport';

describe('local-test endpoint origin guard', () => {
  it.each([
    ['http://localhost:5000/api', 'http://localhost:5000/api/dev/ausemio-test-submit'],
    ['http://127.0.0.1:5000/api', 'http://127.0.0.1:5000/api/dev/ausemio-test-submit'],
    ['http://[::1]:5000/api', 'http://[::1]:5000/api/dev/ausemio-test-submit'],
  ])('allows loopback API base %s', async (apiBase, expectedUrl) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    await postLocalTestSubmission(new FormData(), apiBase, {
      mode: 'development',
      productionBuild: false,
    }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(expectedUrl);
  });

  it.each([
    ['https://example.com/api', { mode: 'development', productionBuild: false }],
    ['https://kosice.ausem.io/api', { mode: 'development', productionBuild: false }],
    ['http://localhost:5000/api', { mode: 'production', productionBuild: true }],
    ['http://localhost:5000/api', { mode: 'development', productionBuild: true }],
    ['not a URL', { mode: 'development', productionBuild: false }],
  ])('blocks %s in %s mode before fetch', async (apiBase, runtime) => {
    const fetcher = vi.fn();
    await expect(postLocalTestSubmission(new FormData(), apiBase, runtime, fetcher))
      .rejects.toMatchObject({ code: 'LOCAL_TEST_TRANSPORT_CONFIG' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
