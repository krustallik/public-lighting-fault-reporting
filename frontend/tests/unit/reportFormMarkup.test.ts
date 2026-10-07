import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getReportFormMessages } from '../../src/i18n/reportFormMessages';
import { ReportFormPage } from '../../src/pages/ReportFormPage/ReportFormPage';
import { ReportFormLocaleProvider } from '../../src/context/ReportFormLocaleContext';

function renderReportForm(): string {
  const tree = createElement(
    ReportFormLocaleProvider,
    null,
    createElement(
      MemoryRouter,
      { initialEntries: [{ pathname: '/report', state: { reportTarget: { kind: 'custom', latitude: 48.7164, longitude: 21.2611 } } }] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/report', element: createElement(ReportFormPage) })
      )
    )
  );
  return renderToStaticMarkup(tree);
}

describe('service-2 VO form structure', () => {
  it('describes address suggestions as derived from the selected coordinates in both locales', () => {
    const slovak = getReportFormMessages('sk').form;
    const english = getReportFormMessages('en').form;

    expect(slovak.addressSuggestionButton).toBe('Navrhnúť adresu pre vybrané súradnice');
    expect(slovak.addressSuggestionApplied).toBe('Adresa bola navrhnutá pre zvolené súradnice. Skontrolujte ju a upravte.');
    expect(english.addressSuggestionButton).toBe('Suggest address for selected coordinates');
    expect(english.addressSuggestionApplied).toBe('An address was suggested for the selected coordinates. Review and edit it.');
  });

  it('renders VO choices in public order and hides unverified optional address assistance', () => {
    const markup = renderReportForm();

    expect(markup).not.toContain('id="service"');
    expect(markup).not.toContain('name="service"');
    expect(markup).toContain('id="locality"');
    expect(markup).toContain('role="combobox"');
    expect(markup).not.toContain('<select id="locality"');

    const radios = markup.match(/<input\b(?=[^>]*type="radio")[^>]*>/g) ?? [];
    const getValues = (name: string) => radios
      .filter((radio) => radio.includes(`name="${name}"`))
      .map((radio) => radio.match(/value="([^"]*)"/)?.[1]);

    expect(getValues('locationBlock')).toEqual(['Q10', 'Q11', 'Q12']);
    expect(getValues('faultType')).toEqual(['Q', 'Q1', 'Q2', 'Q3', 'Q4', 'Q6', 'Q10', 'Q61', 'Q99']);
    expect(radios).toHaveLength(12);
    expect(radios.every((radio) => !/\bchecked(?:=|\s|>)/.test(radio))).toBe(true);
    expect(markup).not.toContain('<select id="locationBlock"');
    expect(markup).not.toContain('<select id="faultType"');

    const locality = markup.indexOf('id="locality"');
    const detail = markup.indexOf('id="detailDescription"');
    const block = markup.indexOf('name="locationBlock"');
    const fault = markup.indexOf('name="faultType"');
    const phone = markup.indexOf('id="phone"');
    const formFooter = markup.indexOf('data-testid="report-form-footer"');
    expect(locality).toBeLessThan(detail);
    expect(markup).not.toContain('Navrhnúť adresu pre vybrané súradnice');
    expect(detail).toBeLessThan(block);
    expect(block).toBeLessThan(fault);
    expect(fault).toBeLessThan(phone);
    expect(phone).toBeLessThan(formFooter);
    expect(markup).not.toContain('id="files"');
    expect(markup).toContain('Ulica / Miesto poruchy / Lokalita');
    expect(markup).toContain('Typ poruchy');
    expect(markup).toContain('Tel. kontakt na Vás');
    expect(markup).toContain('<fieldset');
    expect(markup).toContain('<legend>Lokalizácia - Blok</legend>');
    expect(markup).toContain('<legend>Typ poruchy</legend>');
    expect(markup).toContain('Pred blokom');
    expect(markup).toContain('Vedľa bloku');
    expect(markup).toContain('Za blokom');
    expect(markup).toContain('Svietidlo vôbec nesvieti');
    expect(markup).toContain('Iný druh poruchy');
    expect(markup).not.toContain('id="otherFaultText"');
  });

  it('places the multiple-file local control in step 2, outside the confirmed step-1 order', () => {
    const source = readFileSync(
      new URL('../../src/pages/ReportFormPage/ReportFormPage.tsx', import.meta.url),
      'utf8'
    );
    const stepOneStart = source.indexOf('{step === 1 && (');
    const stepTwoStart = source.indexOf('{step === 2 && (');
    const stepOneSource = source.slice(stepOneStart, stepTwoStart);
    const stepTwoSource = source.slice(stepTwoStart);

    expect(stepOneSource).not.toContain('id="files"');
    expect(stepTwoSource).toContain('id="files"');
    expect(stepTwoSource).toMatch(/type="file"[\s\S]{0,80}multiple/);
    expect(stepTwoSource).not.toContain('accept=');
  });
});
