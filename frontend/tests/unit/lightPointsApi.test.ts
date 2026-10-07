import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLightPoint, getLightPoints } from '../../src/services/lightPointsApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('light points API client contract', () => {
  it('requests the list with GET and maps successful rows while filtering invalid coordinates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [
        {
          id: 42,
          inventory_number: 'LP-42',
          external_id: null,
          latitude: '48.7164',
          longitude: '21.2611',
          address: 'Hlavná 1',
          district: 'Old Town',
          lamp_type: 'LED',
          status: 'active',
        },
        {
          id: 43,
          inventory_number: 'LP-43',
          external_id: null,
          latitude: 'invalid',
          longitude: '21.2611',
          address: 'Invalid row',
          district: null,
          lamp_type: null,
          status: 'inactive',
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLightPoints()).resolves.toEqual([{
      id: 42,
      inventory_number: 'LP-42',
      latitude: 48.7164,
      longitude: 21.2611,
      address: 'Hlavná 1',
      type: 'LED',
      status: 'active',
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/api/light-points');
  });

  it('reports an unsuccessful HTTP status for the list endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLightPoints()).rejects.toThrow('Načítanie svetelných bodov zlyhalo (503)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/api/light-points');
  });

  it('fails when a successful list response contains malformed JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{not-json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLightPoints()).rejects.toThrow(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests one point with GET and maps the successful point used by report autofill', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        id: 7,
        inventory_number: 'LP-7',
        external_id: null,
        latitude: 48.7,
        longitude: 21.25,
        address: 'Jarná 12',
        district: 'Košice',
        lamp_type: 'LED',
        status: 'maintenance',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLightPoint(7)).resolves.toEqual({
      id: 7,
      inventory_number: 'LP-7',
      latitude: 48.7,
      longitude: 21.25,
      address: 'Jarná 12',
      type: 'LED',
      status: 'maintenance',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/api/light-points/7');
  });

  it('returns the client not-found failure for a missing point without parsing an empty body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLightPoint(999)).rejects.toThrow('Svetelný bod sa nenašiel (404)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/api/light-points/999');
  });

  it('rejects an invalid point response instead of autofilling an unusable location', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        id: 7,
        inventory_number: 'LP-7',
        external_id: null,
        latitude: 95,
        longitude: 21.25,
        address: 'Jarná 12',
        district: 'Košice',
        lamp_type: 'LED',
        status: 'active',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLightPoint(7)).rejects.toThrow('Svetelný bod má neplatné súradnice');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/api/light-points/7');
  });
});
