import { describe, expect, it } from 'vitest';
import { addressMatchesCidr, normalizeLimiterAddress, parseAddress, parseCidr, parseTrustedProxyCidrs } from '../../src/security/clientAddress.js';
import { createAddressIpLimiter } from '../../src/security/addressIpLimiter.js';

const settings = { burst: 2, refillPerMinute: 60, maxKeys: 2, idleTtlMs: 1000 };

describe('client address normalization and CIDRs', () => {
  it('normalizes IPv4-mapped IPv6 and equivalent IPv6 notation', () => {
    expect(parseAddress('::ffff:192.0.2.9')?.normalized).toBe('192.0.2.9');
    expect(normalizeLimiterAddress('2001:db8::1')).toBe(normalizeLimiterAddress('2001:0db8:0:0:0:0:0:1'));
    expect(normalizeLimiterAddress('2001:db8::1')).toBe(normalizeLimiterAddress('2001:db8::abcd'));
    expect(normalizeLimiterAddress('2001:db8:1::1')).not.toBe(normalizeLimiterAddress('2001:db8::1'));
  });

  it('strictly parses trusted CIDRs and matches their prefixes', () => {
    const cidr = parseCidr('10.20.0.0/16');
    expect(addressMatchesCidr('10.20.3.4', cidr)).toBe(true);
    expect(addressMatchesCidr('10.21.3.4', cidr)).toBe(false);
    expect(parseTrustedProxyCidrs('127.0.0.1/32,2001:db8::/32')).toHaveLength(2);
    expect(() => parseTrustedProxyCidrs('10.0.0.0/8,')).toThrow();
    expect(() => parseCidr('192.0.2.1/33')).toThrow();
    expect(() => parseCidr('name/24')).toThrow();
  });
});

describe('process-local address limiter', () => {
  it('enforces burst and deterministic refill without retaining raw addresses', () => {
    let now = 0;
    const limiter = createAddressIpLimiter(settings, () => now, Buffer.alloc(32, 7));
    expect(limiter.consume('192.0.2.9')).toEqual({ allowed: true });
    expect(limiter.consume('::ffff:192.0.2.9')).toEqual({ allowed: true });
    expect(limiter.consume('192.0.2.9')).toMatchObject({ allowed: false, code: 'rate_limited', retryAfterSeconds: 1 });
    now = 1000;
    expect(limiter.consume('192.0.2.9')).toEqual({ allowed: true });
    expect(limiter.size()).toBe(1);
  });

  it('aggregates IPv6 by /64 and fails closed when capacity is full', () => {
    const limiter = createAddressIpLimiter(settings, () => 0, Buffer.alloc(32, 9));
    limiter.consume('2001:db8::1');
    limiter.consume('2001:db8::2');
    expect(limiter.size()).toBe(1);
    expect(limiter.consume('192.0.2.1')).toMatchObject({ allowed: true });
    expect(limiter.consume('198.51.100.2')).toMatchObject({ allowed: false, code: 'limiter_capacity' });
  });

  it('evicts idle buckets only and rejects invalid client address without allocating state', () => {
    let now = 0;
    const limiter = createAddressIpLimiter(settings, () => now, Buffer.alloc(32, 5));
    expect(limiter.consume('bad address')).toMatchObject({ allowed: false, code: 'limiter_capacity' });
    expect(limiter.size()).toBe(0);
    limiter.consume('192.0.2.1');
    limiter.consume('192.0.2.2');
    now = 1000;
    expect(limiter.consume('192.0.2.3')).toMatchObject({ allowed: true });
    expect(limiter.size()).toBe(1);
  });
});
