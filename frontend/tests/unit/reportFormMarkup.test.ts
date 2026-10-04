import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReportFormPage } from '../../src/pages/ReportFormPage/ReportFormPage';

function renderReportForm(): string {
  const tree = createElement(
    MemoryRouter,
    { initialEntries: ['/report?lat=48.7164&lng=21.2611'] },
    createElement(
      Routes,
      null,
      createElement(Route, { path: '/report', element: createElement(ReportFormPage) })
    )
  );
  return renderToStaticMarkup(tree);
}

describe('service-2 VO form structure', () => {
  it('does not render a service selector and starts with locality before the VO fields', () => {
    const markup = renderReportForm();

    expect(markup).not.toContain('id="service"');
    expect(markup).not.toContain('name="service"');
    expect(markup).toContain('id="locality"');
    expect(markup.indexOf('id="locality"')).toBeLessThan(markup.indexOf('id="detailDescription"'));
    expect(markup.indexOf('id="detailDescription"')).toBeLessThan(markup.indexOf('id="locationBlock"'));
    expect(markup.indexOf('id="locationBlock"')).toBeLessThan(markup.indexOf('id="faultType"'));
    expect(markup.indexOf('id="faultType"')).toBeLessThan(markup.indexOf('id="phone"'));
    expect(markup.indexOf('id="phone"')).toBeLessThan(markup.indexOf('id="files"'));
    expect(markup).toContain('Ulica / Miesto poruchy / Lokalita');
    expect(markup).toContain('Typ poruchy');
    expect(markup).toContain('Tel. kontakt na Vás');
    expect(markup).not.toContain('id="otherFaultText"');
  });

  it('allows multiple files with no accept filter and does not advertise the old five-file limit', () => {
    const markup = renderReportForm();
    expect(markup).toMatch(/<input[^>]+type="file"[^>]+multiple/);
    expect(markup).not.toContain('accept="image/*"');
    expect(markup).not.toContain('max. 5');
  });
});
