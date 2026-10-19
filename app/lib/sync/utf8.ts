// UTF-8 decoding without TextDecoder (missing on some React Native runtimes). Pure.

/** Decodes UTF-8 bytes to a string. Invalid sequences become U+FFFD. */
export function utf8Decode(b: Uint8Array): string {
  const parts: string[] = [];
  let units: number[] = [];
  const cont = (i: number) => (i < b.length && (b[i] & 0xc0) === 0x80 ? b[i] & 63 : -1);
  for (let i = 0; i < b.length;) {
    const c = b[i];
    let cp = 0xfffd, len = 1;
    if (c < 0x80) cp = c;
    else if (c >= 0xc2 && c < 0xe0) { const x = cont(i + 1); if (x >= 0) { cp = ((c & 31) << 6) | x; len = 2; } }
    else if (c >= 0xe0 && c < 0xf0) {
      const x = cont(i + 1), y = cont(i + 2);
      if (x >= 0 && y >= 0) { const v = ((c & 15) << 12) | (x << 6) | y; if (v >= 0x800 && (v < 0xd800 || v > 0xdfff)) { cp = v; len = 3; } }
    } else if (c >= 0xf0 && c < 0xf5) {
      const x = cont(i + 1), y = cont(i + 2), z = cont(i + 3);
      if (x >= 0 && y >= 0 && z >= 0) { const v = ((c & 7) << 18) | (x << 12) | (y << 6) | z; if (v >= 0x10000 && v <= 0x10ffff) { cp = v; len = 4; } }
    }
    i += len;
    if (cp > 0xffff) { cp -= 0x10000; units.push(0xd800 | (cp >> 10), 0xdc00 | (cp & 0x3ff)); }
    else units.push(cp);
    if (units.length >= 8192) { parts.push(String.fromCharCode(...units)); units = []; }
  }
  parts.push(String.fromCharCode(...units));
  return parts.join('');
}
