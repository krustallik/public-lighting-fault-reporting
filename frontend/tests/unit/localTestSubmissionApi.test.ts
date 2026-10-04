import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/services/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local test submission transport', () => {
  it('posts multipart data only to the local test endpoint without an external fallback', async () => {
    const formData = new FormData();
    formData.append('properties[vyber_sluzby]', '2');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          status: 'local_test_received',
          fields: { 'properties[vyber_sluzby]': '2' },
          files: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.sendLocalTestSubmission(formData);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:5000/api/dev/ausemio-test-submit');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: formData });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Content-Type');
    expect(result.status).toBe('local_test_received');
  });

  it('reports an unavailable local endpoint and makes no second transport attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, message: 'Route not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.sendLocalTestSubmission(new FormData())).rejects.toThrow(
      /local test submission endpoint is unavailable/i
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
