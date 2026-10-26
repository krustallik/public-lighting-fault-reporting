import { describe, expect, it } from 'vitest';
import { createLocalUatSyntheticTilesPlugin } from '../../scripts/localUatSyntheticTilesPlugin';

type Middleware = (request: { url?: string; method?: string }, response: {
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}, next: () => void) => void;

function middlewareFor(enabled: boolean): Middleware | undefined {
  let handler: Middleware | undefined;
  const plugin = createLocalUatSyntheticTilesPlugin(enabled);
  const configure = plugin.configureServer as unknown as ((server: unknown) => unknown) | undefined;
  configure?.({
    middlewares: { use: (value: Middleware) => { handler = value; } },
  } as never);
  return handler;
}

function request(handler: Middleware, method: string, url: string) {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    end(body?: string) { this.body = body; },
  };
  let nextCalled = false;
  handler({ method, url }, response, () => { nextCalled = true; });
  return { response, nextCalled };
}

describe('local UAT synthetic tile middleware', () => {
  it('serves generated, labelled tiles only for matching GET and HEAD requests', () => {
    const handler = middlewareFor(true)!;
    const get = request(handler, 'GET', '/__local_uat/tiles/light/1/2/3.svg');
    expect(get.response.statusCode).toBe(200);
    expect(get.response.headers['content-type']).toContain('image/svg+xml');
    expect(get.response.headers['cache-control']).toBe('no-store');
    expect(get.response.body).toContain('SYNTHETIC LOCAL MAP');

    const head = request(handler, 'HEAD', '/__local_uat/tiles/dark/1/2/3.svg');
    expect(head.response.statusCode).toBe(200);
    expect(head.response.body).toBeUndefined();
  });

  it('rejects invalid paths and methods without handling unrelated requests', () => {
    const handler = middlewareFor(true)!;
    expect(request(handler, 'GET', '/__local_uat/tiles/light/a/2/3.svg').response.statusCode).toBe(404);
    const post = request(handler, 'POST', '/__local_uat/tiles/light/1/2/3.svg');
    expect(post.response.statusCode).toBe(405);
    expect(post.response.headers.allow).toBe('GET, HEAD');
    expect(request(handler, 'GET', '/api/health').nextCalled).toBe(true);
    expect(middlewareFor(false)).toBeUndefined();
  });
});
