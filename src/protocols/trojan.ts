/** Trojan request parser. Wire format: https://trojan-gfw.github.io/trojan/protocol.html */
import { GzError } from '../config';
import { ParsedTarget } from './common';
import { utf8Decode } from '../utils/crypto';

export interface TrojanRequest extends ParsedTarget { isUDP: boolean; }

/**
 * SHA224 hex, CRLF, CMD, SOCKS5 ATYP, address, network-order port, CRLF.
 * Truncated input is distinguished from malformed input so WS reads can continue.
 */
export function parseTrojan(chunk: Uint8Array): TrojanRequest {
  if (chunk.length < 60) throw new GzError('short trojan header', 'bad_request');
  const hash = utf8Decode(chunk.slice(0, 56));
  if (!/^[0-9a-f]{56}$/.test(hash)) throw new GzError('bad trojan hash', 'bad_request');
  if (chunk[56] !== 13 || chunk[57] !== 10) throw new GzError('bad trojan crlf', 'bad_request');
  const cmd = chunk[58];
  if (cmd !== 1 && cmd !== 3) throw new GzError('unsupported trojan command', 'bad_request');
  const atyp = chunk[59];
  let i = 60;
  let host: string;
  if (atyp === 1) {
    if (chunk.length < i + 4) throw new GzError('short trojan ipv4', 'bad_request');
    host = chunk.slice(i, i + 4).join('.');
    i += 4;
  } else if (atyp === 3) {
    if (chunk.length < i + 1) throw new GzError('short trojan domain length', 'bad_request');
    const len = chunk[i++];
    if (!len) throw new GzError('empty trojan domain', 'bad_request');
    if (chunk.length < i + len) throw new GzError('short trojan domain', 'bad_request');
    host = utf8Decode(chunk.slice(i, i + len));
    i += len;
  } else if (atyp === 4) {
    if (chunk.length < i + 16) throw new GzError('short trojan ipv6', 'bad_request');
    const words: string[] = [];
    for (let j = 0; j < 16; j += 2) words.push(((chunk[i + j] << 8) | chunk[i + j + 1]).toString(16));
    host = words.join(':');
    i += 16;
  } else {
    throw new GzError('unsupported trojan address type', 'bad_request');
  }
  if (chunk.length < i + 4) throw new GzError('short trojan port or crlf', 'bad_request');
  const port = (chunk[i] << 8) | chunk[i + 1];
  if (port === 0) throw new GzError('invalid trojan port', 'bad_request');
  if (chunk[i + 2] !== 13 || chunk[i + 3] !== 10) throw new GzError('bad trojan crlf2', 'bad_request');
  return { host, port, headerLen: i + 4, isUDP: cmd === 3 };
}
