import type { LightPointStatus } from '@shared/LightPointStatus';

export const STATUS_LABELS: Record<LightPointStatus, string> = {
  active: 'Aktívny',
  inactive: 'Neaktívny',
  maintenance: 'Údržba',
};
