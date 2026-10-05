import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResultPage } from '../../src/pages/ResultPage/ResultPage';

describe('local test result semantics', () => {
  it('states local receipt only and does not claim external acceptance or show an external target', () => {
    const tree = createElement(
      MemoryRouter,
      {
        initialEntries: [
          {
            pathname: '/result',
            state: {
              success: true,
              status: 'local_test_received',
              message: 'Request received by the local test endpoint only.',
            },
          },
        ],
      },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/result', element: createElement(ResultPage) })
      )
    );
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain('LOCAL TEST / SIMULATED');
    expect(markup).toContain('local_test_received');
    expect(markup).toContain('local test endpoint only');
    expect(markup).not.toMatch(/Hlásenie bolo prijaté|accepted|submitted|odoslané/i);
    expect(markup).not.toContain('/api/reports/send');
    expect(markup).not.toContain('targetUrl');
    expect(markup).not.toContain('AUSEMIO payload preview');
  });

  it('renders endpoint failure without success status or alternate-transport claims', () => {
    const tree = createElement(
      MemoryRouter,
      {
        initialEntries: [
          {
            pathname: '/result',
            state: {
              success: false,
              errorCode: 'LOCAL_TEST_TRANSPORT_UNAVAILABLE',
              message: 'Synthetic local endpoint unavailable.',
            },
          },
        ],
      },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/result', element: createElement(ResultPage) })
      )
    );
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain('Local test submission endpoint unavailable');
    expect(markup).toContain('LOCAL_TEST_TRANSPORT_UNAVAILABLE');
    expect(markup).toContain('Synthetic local endpoint unavailable.');
    expect(markup).toContain('No alternate report transport was attempted.');
    expect(markup).not.toContain('LOCAL TEST / SIMULATED');
    expect(markup).not.toContain('local_test_received');
    expect(markup).not.toContain('/api/reports/send');
  });

  it('keeps the existing direct-navigation fallback when router state is absent', () => {
    const tree = createElement(
      MemoryRouter,
      { initialEntries: ['/result'] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/result', element: createElement(ResultPage) })
      )
    );
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain('Výsledok lokálneho testu');
    expect(markup).toContain('Nie sú dostupné údaje lokálneho testu.');
    expect(markup).toContain('/report');
    expect(markup).not.toContain('LOCAL TEST / SIMULATED');
  });
});
