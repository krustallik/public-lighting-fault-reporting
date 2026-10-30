import { describe, expect, it } from 'vitest';
import { createReportAddressProof, normalizeReportAddress, verifyReportAddressProof } from '../../src/services/reportAddressProof.js';

const secret = 'test-only-report-address-proof-secret';
const address = 'Hlavná 1, Košice';
const proof = createReportAddressProof(address, 'custom', 48.7, 21.25, secret);

describe('report address provenance proof', () => {
  it('normalizes provider text and validates the address against its exact target', () => {
    expect(normalizeReportAddress('  Hlavná\n  1, Košice  ')).toBe(address);
    expect(proof).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(verifyReportAddressProof(address, 'custom', 48.7, 21.25, proof, secret)).toBe(true);
    expect(verifyReportAddressProof('Other street, Košice', 'custom', 48.7, 21.25, proof, secret)).toBe(false);
    expect(verifyReportAddressProof(address, 'custom', 48.70001, 21.25, proof, secret)).toBe(false);
    expect(verifyReportAddressProof(address, 'device', 48.7, 21.25, proof, secret)).toBe(false);
  });

  it('fails closed for malformed proofs, invalid addresses, and missing signing secrets', () => {
    expect(verifyReportAddressProof(address, 'custom', 48.7, 21.25, 'not-a-proof', secret)).toBe(false);
    expect(verifyReportAddressProof(address, 'custom', 48.7, 21.25, proof, 'wrong-secret')).toBe(false);
    expect(verifyReportAddressProof('', 'custom', 48.7, 21.25, proof, secret)).toBe(false);
    expect(() => createReportAddressProof(' ', 'custom', 48.7, 21.25, secret)).toThrow();
    expect(() => createReportAddressProof(address, 'custom', Number.NaN, 21.25, secret)).toThrow();
  });
});
