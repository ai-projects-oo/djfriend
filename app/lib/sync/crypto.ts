// End-to-end encryption for device sync. XChaCha20-Poly1305 (@noble/ciphers, MIT, audited, pure JS).
// Pure: randomness is passed in, so this runs unchanged in Electron, the browser and React Native.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import type { PairingPayload, SyncEnvelope } from '../../types';

export type RandomBytes = (n: number) => Uint8Array;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map(k => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    if (v.some(x => x < 0)) throw new Error('Invalid base64url');
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** A fresh pairing: random sync id (what the relay sees) and random key (never leaves the devices). */
export function newPairing(random: RandomBytes, relay: string): PairingPayload {
  return { v: 1, syncId: toBase64Url(random(16)), key: toBase64Url(random(32)), relay: relay.replace(/\/+$/, '') };
}

/** Parses and validates a scanned pairing QR. Null if it isn't one. */
export function parsePairing(text: string): PairingPayload | null {
  try {
    const p = JSON.parse(text) as Partial<PairingPayload>;
    if (p.v !== 1 || typeof p.syncId !== 'string' || typeof p.key !== 'string' || typeof p.relay !== 'string') return null;
    if (fromBase64Url(p.key).length !== 32 || fromBase64Url(p.syncId).length !== 16) return null;
    if (!/^https?:\/\//.test(p.relay)) return null;
    return { v: 1, syncId: p.syncId, key: p.key, relay: p.relay };
  } catch { return null; }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Encrypts a JSON value. The sync id is bound as associated data, so ciphertext copied into
 * another sync space fails to decrypt.
 */
export function encryptJson(pairing: Pick<PairingPayload, 'key' | 'syncId'>, value: unknown, random: RandomBytes): SyncEnvelope {
  const nonce = random(24);
  const cipher = xchacha20poly1305(fromBase64Url(pairing.key), nonce, enc.encode(pairing.syncId));
  return { n: toBase64Url(nonce), c: toBase64Url(cipher.encrypt(enc.encode(JSON.stringify(value)))) };
}

/** Decrypts and parses; throws if the key is wrong or the data was tampered with. */
export function decryptJson<T>(pairing: Pick<PairingPayload, 'key' | 'syncId'>, env: SyncEnvelope): T {
  const cipher = xchacha20poly1305(fromBase64Url(pairing.key), fromBase64Url(env.n), enc.encode(pairing.syncId));
  return JSON.parse(dec.decode(cipher.decrypt(fromBase64Url(env.c)))) as T;
}
