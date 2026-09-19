/** ID and seed helpers (ported from api/ids.py). */

const CROCKFORD32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_SEED = 2 ** 31 - 1;

function encodeCrockford(value: bigint, length: number): string {
  const chars: string[] = [];
  let remaining = value;
  for (let i = 0; i < length; i += 1) {
    chars.push(CROCKFORD32[Number(remaining & 31n)]);
    remaining >>= 5n;
  }
  return chars.reverse().join('');
}

/** ULID-like, time-sortable 26-character id. */
export function newUlid(): string {
  const timestamp = BigInt(Date.now());
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let randomness = 0n;
  for (const byte of bytes) {
    randomness = (randomness << 8n) | BigInt(byte);
  }
  return encodeCrockford(timestamp, 10) + encodeCrockford(randomness, 16);
}

/** Explicit Gemini seed in a conservative signed 32-bit range (1..2^31-1). */
export function newSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % MAX_SEED) + 1;
}
