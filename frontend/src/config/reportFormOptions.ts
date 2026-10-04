import {
  AUSEMIO_FAULT_TYPES,
  AUSEMIO_LOCATION_BLOCKS,
} from './ausemioForm';

export type ReportFaultTypeCode = (typeof AUSEMIO_FAULT_TYPES)[number]['value'];
export type ReportLocationBlockCode = (typeof AUSEMIO_LOCATION_BLOCKS)[number]['value'];

export const REPORT_FAULT_TYPE_CODES: readonly ReportFaultTypeCode[] = AUSEMIO_FAULT_TYPES.map(
  ({ value }) => value
);
export const REPORT_LOCATION_BLOCK_CODES: readonly ReportLocationBlockCode[] =
  AUSEMIO_LOCATION_BLOCKS.map(({ value }) => value);
