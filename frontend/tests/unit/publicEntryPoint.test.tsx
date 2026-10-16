// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ render: vi.fn(), createRoot: vi.fn() }));

vi.mock('react-dom/client', () => ({
  createRoot: mocks.createRoot.mockImplementation((element: HTMLElement | null) => ({ render: (node: unknown) => mocks.render(element, node) })),
}));
vi.mock('@/App', () => ({ default: () => null }));

afterEach(() => {
  document.body.innerHTML = '';
  mocks.render.mockClear();
  mocks.createRoot.mockClear();
  vi.resetModules();
});

describe('public browser entry point', () => {
  it('mounts the public application into the root element', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import('@/main');

    expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    expect(mocks.render).toHaveBeenCalledOnce();
  });
});
