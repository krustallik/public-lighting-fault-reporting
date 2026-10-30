import { createHmac, timingSafeEqual } from 'node:crypto';

export type ReportAddressTargetKind = 'custom' | 'device';

const PROOF_VERSION = 'v1';
const PROOF_KEY_PURPOSE = 'plfr:report-address-proof:key:v1';

export function normalizeReportAddress(value: string): string {
  return value.normalize('NFC').replace(/[\p{Cc}\s]+/gu, ' ').trim();
}

function proofMessage(
  address: string,
  targetKind: ReportAddressTargetKind,
  latitude: number,
  longitude: number
): string {
  return JSON.stringify([
    PROOF_VERSION,
    normalizeReportAddress(address),
    targetKind,
    latitude,
    longitude,
  ]);
}

function signingKey(secret: string): Buffer {
  return createHmac('sha256', secret).update(PROOF_KEY_PURPOSE).digest();
}

export function createReportAddressProof(
  address: string,
  targetKind: ReportAddressTargetKind,
  latitude: number,
  longitude: number,
  secret: string
): string {
  const normalized = normalizeReportAddress(address);
  if (!secret || !normalized || normalized.length > 500 ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Cannot sign invalid report address metadata.');
  }
  const signature = createHmac('sha256', signingKey(secret))
    .update(proofMessage(normalized, targetKind, latitude, longitude))
    .digest('base64url');
  return `${PROOF_VERSION}.${signature}`;
}

export function verifyReportAddressProof(
  address: string,
  targetKind: ReportAddressTargetKind,
  latitude: number,
  longitude: number,
  proof: string,
  secret: string
): boolean {
  if (!secret || !/^v1\.[A-Za-z0-9_-]{43}$/.test(proof) ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  try {
    const expected = Buffer.from(createReportAddressProof(address, targetKind, latitude, longitude, secret).slice(3), 'base64url');
    const supplied = Buffer.from(proof.slice(3), 'base64url');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}
