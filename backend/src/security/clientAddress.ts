import { isIP } from 'node:net';

export interface ParsedAddress { family: 4 | 6; bits: bigint; normalized: string }
export interface AddressCidr extends ParsedAddress { prefix: number }

function parseIpv4(value: string): ParsedAddress | undefined {
  if (isIP(value) !== 4) return undefined;
  const octets = value.split('.').map(Number);
  const bits = octets.reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
  return { family: 4, bits, normalized: octets.join('.') };
}

function parseIpv6(value: string): ParsedAddress | undefined {
  if (isIP(value) !== 6 || value.includes('%')) return undefined;
  let source = value.toLowerCase();
  const lastColon = source.lastIndexOf(':');
  if (source.slice(lastColon + 1).includes('.')) {
    const parsedV4 = parseIpv4(source.slice(lastColon + 1));
    if (!parsedV4) return undefined;
    const high = Number((parsedV4.bits >> 16n) & 0xffffn).toString(16);
    const low = Number(parsedV4.bits & 0xffffn).toString(16);
    source = `${source.slice(0, lastColon)}:${high}:${low}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[\da-f]{1,4}$/.test(word))) return undefined;
  const bits = words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
  if ((bits >> 32n) === 0xffffn) {
    const mapped = bits & 0xffffffffn;
    const normalized = [24n, 16n, 8n, 0n].map((offset) => Number((mapped >> offset) & 255n)).join('.');
    return { family: 4, bits: mapped, normalized };
  }
  return { family: 6, bits, normalized: words.map((word) => Number.parseInt(word, 16).toString(16)).join(':') };
}

export function parseAddress(value: string): ParsedAddress | undefined {
  return parseIpv4(value) ?? parseIpv6(value);
}

export function parseCidr(value: string): AddressCidr {
  const [addressText, prefixText, extra] = value.trim().split('/');
  if (!addressText || extra !== undefined) throw new Error('Invalid trusted proxy CIDR.');
  const address = parseAddress(addressText);
  if (!address) throw new Error('Invalid trusted proxy address.');
  const maxBits = address.family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? maxBits : /^\d+$/.test(prefixText) ? Number(prefixText) : -1;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) throw new Error('Invalid trusted proxy prefix.');
  const hostBits = BigInt(maxBits - prefix);
  const mask = hostBits === 0n ? (1n << BigInt(maxBits)) - 1n : ((1n << BigInt(maxBits)) - 1n) ^ ((1n << hostBits) - 1n);
  return { ...address, bits: address.bits & mask, prefix };
}

export function parseTrustedProxyCidrs(value: string | undefined): AddressCidr[] {
  if (!value?.trim()) return [];
  return value.split(',').map((part) => {
    if (!part.trim()) throw new Error('TRUST_PROXY_CIDRS contains an empty entry.');
    return parseCidr(part);
  });
}

export function addressMatchesCidr(addressText: string, cidr: AddressCidr): boolean {
  const address = parseAddress(addressText);
  if (!address || address.family !== cidr.family) return false;
  const maxBits = address.family === 4 ? 32 : 128;
  const hostBits = BigInt(maxBits - cidr.prefix);
  const mask = hostBits === 0n ? (1n << BigInt(maxBits)) - 1n : ((1n << BigInt(maxBits)) - 1n) ^ ((1n << hostBits) - 1n);
  return (address.bits & mask) === cidr.bits;
}

export function normalizeLimiterAddress(value: string): string | undefined {
  const address = parseAddress(value);
  if (!address) return undefined;
  if (address.family === 4) return `v4:${address.normalized}`;
  return `v6-64:${(address.bits >> 64n).toString(16)}`;
}

export function createProxyTrustPredicate(cidrs: readonly AddressCidr[]): (address: string) => boolean {
  return (address) => cidrs.some((cidr) => addressMatchesCidr(address, cidr));
}
