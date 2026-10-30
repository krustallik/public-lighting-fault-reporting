const OPERATOR_TIME_ZONE = 'Europe/Bratislava';

const operatorDateTimeFormatter = new Intl.DateTimeFormat('sk-SK', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: OPERATOR_TIME_ZONE,
});

export function formatOperatorDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : operatorDateTimeFormatter.format(date);
}
