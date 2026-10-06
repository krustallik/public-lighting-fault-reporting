import { describe, expect, it } from 'vitest';
import {
  AUSEMIO_FAULT_TYPE_OTHER,
  AUSEMIO_SERVICE_VO,
} from '../../src/config/ausemioForm';
import {
  REPORT_FAULT_TYPE_CODES,
  REPORT_LOCATION_BLOCK_CODES,
} from '../../src/config/reportFormOptions';
import { getReportFormMessages } from '../../src/i18n/reportFormMessages';

describe('canonical AUSEMIO service-2 VO contract', () => {
  it('fixes the product service to VO and contains exactly the public block/fault codes', () => {
    expect(AUSEMIO_SERVICE_VO).toBe('2');
    expect(REPORT_LOCATION_BLOCK_CODES).toEqual(['Q10', 'Q11', 'Q12']);
    expect(REPORT_FAULT_TYPE_CODES).toEqual([
      'Q',
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q6',
      'Q10',
      'Q61',
      'Q99',
    ]);
    expect(AUSEMIO_FAULT_TYPE_OTHER).toBe('Q99');
    expect(REPORT_FAULT_TYPE_CODES).not.toContain('Q5');
    expect(REPORT_FAULT_TYPE_CODES).not.toContain('Q20');
  });

  it('uses the confirmed Slovak headings and public option labels', () => {
    const messages = getReportFormMessages('sk');
    expect(messages.form.streetLabel).toBe('Ulica / Miesto poruchy / Lokalita');
    expect(messages.form.detailLabel).toBe('Bližší popis / orientačný bod / číslo stožiara');
    expect(messages.form.locationBlockLabel).toBe('Lokalizácia - Blok');
    expect(messages.form.faultTypeLabel).toBe('Typ poruchy');
    expect(messages.form.otherFaultLabel).toBe('Iný druh poruchy');
    expect(messages.form.phoneLabel).toBe('Tel. kontakt na Vás');
    expect(messages.locationBlocks).toEqual({
      Q10: 'Pred blokom',
      Q11: 'Vedľa bloku',
      Q12: 'Za blokom',
    });
    expect(messages.faultTypes).toEqual({
      Q: 'Svietidlo vôbec nesvieti',
      Q1: 'Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne',
      Q2: 'Nesvieti celá skupina svietidiel',
      Q3: 'Poškodený stožiar',
      Q4: 'Odkryté elektrické zariadenie / kabeláž',
      Q6: 'Poškodená pätica / pätka / betónový základ',
      Q10: 'Krivý alebo nahnutý stožiar / výložník / svietidlo',
      Q61: 'Potrebný orez drevín - zarastený stožiar / rozvádzač',
      Q99: 'Iný druh poruchy',
    });
  });

  it('translates option descriptions and all public stages into English', () => {
    const english = getReportFormMessages('en');
    expect(english.form.streetLabel).toBe('Street / fault location / locality');
    expect(english.form.detailLabel).toBe('Additional description / landmark / pole number');
    expect(english.form.locationBlockLabel).toBe('Location relative to block');
    expect(english.locationBlocks.Q10).toBe('In front of the block');
    expect(english.faultTypes.Q).toBe('Street light does not turn on');
    expect(english.faultTypes.Q99).toBe('Other type of fault');
    expect(english.map.hint).toContain('Select an existing light point');
    expect(english.confirmation.title).toBe('Confirm report location');
    expect(english.result.successTitle).toBe('LOCAL TEST / SIMULATED');
  });
});
