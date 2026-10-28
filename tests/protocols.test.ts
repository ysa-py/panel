import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseTrojan } from '../src/protocols/trojan';
import { parseVless, vlessOkResponse } from '../src/protocols/vless';
import { sha224Hex } from '../src/utils/sha224';

const encode = (s: string) => [...new TextEncoder().encode(s)];
const uuidBytes = [0x12,0x34,0x56,0x78,0x12,0x34,0x40,0x00,0x80,0x00,0x12,0x34,0x56,0x78,0x90,0xab];
const host = 'edge.example';
const vless = Uint8Array.from([0, ...uuidBytes, 0, 1, 0x01, 0xbb, 2, host.length, ...encode(host)]);
const trojan = Uint8Array.from([...encode('a'.repeat(56)), 13, 10, 1, 3, host.length, ...encode(host), 0x01, 0xbb, 13, 10]);

describe('real protocol wire fixtures', () => {
  it('parses VLESS in wire order and produces the response bytes', () => {
    expect(parseVless(vless)).toMatchObject({ version: 0, uuid: '12345678-1234-4000-8000-1234567890ab', host, port: 443, isUDP: false, headerLen: vless.length });
    expect([...vlessOkResponse(0)]).toEqual([0, 0]);
  });
  it('parses Trojan SOCKS address before the port', () => {
    expect(parseTrojan(trojan)).toEqual({ host, port: 443, isUDP: false, headerLen: trojan.length });
  });
  it('parses Trojan IPv4, IPv6 and UDP command independently', () => {
    const prefix = [...encode('b'.repeat(56)), 13, 10];
    const ipv4 = Uint8Array.from([...prefix, 1, 1, 203, 0, 113, 9, 0x1f, 0x90, 13, 10]);
    expect(parseTrojan(ipv4)).toMatchObject({ host: '203.0.113.9', port: 8080 });
    const ipv6 = Uint8Array.from([...prefix, 3, 4, 0x20,1,0x0d,0xb8,0,0,0,0,0,0,0,0,0,0,0,1, 0,53,13,10]);
    expect(parseTrojan(ipv6)).toMatchObject({ host: '2001:db8:0:0:0:0:0:1', port: 53, isUDP: true });
  });
  it('rejects every truncated header rather than accepting partial data', () => {
    for (let i=0; i<trojan.length; i++) expect(() => parseTrojan(trojan.slice(0,i)), `trojan ${i}`).toThrow();
    for (let i=0; i<vless.length; i++) expect(() => parseVless(vless.slice(0,i)), `vless ${i}`).toThrow();
  });
  it('rejects malformed Trojan framing, address types, and port zero', () => {
    const malformed = trojan.slice(); malformed[57] = 11;
    expect(() => parseTrojan(malformed)).toThrow();
    const badType = trojan.slice(); badType[59] = 2;
    expect(() => parseTrojan(badType)).toThrow();
    const badPort = trojan.slice(); badPort[badPort.length-4] = 0; badPort[badPort.length-3] = 0;
    expect(() => parseTrojan(badPort)).toThrow();
  });
  it('SHA-224 matches Node crypto for empty, Unicode and multi-block inputs', () => {
    for (const input of ['', 'hello', 'آزمایش', 'x'.repeat(1000)]) {
      expect(sha224Hex(input)).toBe(createHash('sha224').update(input).digest('hex'));
    }
  });
});
