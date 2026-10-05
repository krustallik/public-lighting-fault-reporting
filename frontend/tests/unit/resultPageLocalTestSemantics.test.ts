// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResultPage } from '../../src/pages/ResultPage/ResultPage';
import type { ReportResultState } from '../../src/types/reportResult';

afterEach(cleanup);

function renderMountedResult(state?: ReportResultState): void {
  const entry = state ? { pathname: '/result', state } : '/result';
  render(createElement(
    MemoryRouter,
    { initialEntries: [entry] },
    createElement(
      Routes,
      null,
      createElement(Route, { path: '/result', element: createElement(ResultPage) })
    )
  ));
}

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

  it('keeps the direct-navigation fallback and returns users to the map-first flow', () => {
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
    expect(markup).toContain('Pokračovať na mapu');
    expect(markup).not.toContain('href="/report"');
    expect(markup).not.toContain('LOCAL TEST / SIMULATED');
  });

  it.each(['sk', 'en'] as const)(
    'mounts a truthful simulated success result for locale state %s without an external reference',
    (locale) => {
      renderMountedResult({
        success: true,
        status: 'local_test_received',
        message: 'Received by local test endpoint only; not sent to AUSEMIO.',
        locale,
      });

      expect(screen.getByRole('heading', { name: 'LOCAL TEST / SIMULATED' })).not.toBeNull();
      expect(screen.getByText('local_test_received')).not.toBeNull();
      expect(screen.getByText('Received by local test endpoint only; not sent to AUSEMIO.'))
        .not.toBeNull();
      expect(screen.queryByText(/issue reference|external reference/i)).toBeNull();
      expect(screen.queryByText(/accepted by AUSEMIO/i)).toBeNull();
    }
  );

  it.each([
    ['LOCAL_TEST_TRANSPORT_UNAVAILABLE', 'Local endpoint unavailable.'],
    ['LOCAL_TEST_RESOURCE_LIMIT', 'Local test upload limit exceeded.'],
    ['LOCAL_TEST_INVALID_PAYLOAD', 'The synthetic payload was rejected.'],
    ['LOCAL_TEST_ENDPOINT_RESPONSE_ERROR', 'The local endpoint returned an unreadable response.'],
  ])('mounts failure state %s without a success or external-transport claim', (errorCode, message) => {
    renderMountedResult({ success: false, errorCode, message, locale: 'en' });

    expect(screen.getByRole('heading', { name: /Local test/ })).not.toBeNull();
    expect(screen.getByText(errorCode)).not.toBeNull();
    expect(screen.getByText(message)).not.toBeNull();
    expect(screen.getByText('No alternate report transport was attempted.')).not.toBeNull();
    expect(screen.queryByText('LOCAL TEST / SIMULATED')).toBeNull();
    expect(screen.queryByText('local_test_received')).toBeNull();
    expect(screen.queryByText(/issue reference|external reference/i)).toBeNull();
  });
});
