// 64-bit simhash over body text for near-duplicate detection.
// Pure module — no Electron/DB imports.
//
// Features are word 2-shingles hashed with FNV-1a 64-bit; each feature votes
// per bit and the sign of the vote sum forms the fingerprint. Two pages whose
// fingerprints differ by a small Hamming distance (≤ NEAR_DUPLICATE_MAX_DISTANCE)
// have highly similar content even when the bytes differ.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** Hamming distance at or below this = near-duplicate (~90%+ similar).
 *  Calibrated: 300-word text with 10% of words changed ≈ 7 bits; unrelated
 *  texts (even with shared vocabulary/boilerplate) ≥ 14 bits. */
export const NEAR_DUPLICATE_MAX_DISTANCE = 8;

/** Pages with fewer words than this are too small for a stable fingerprint —
 *  with few shingles, single-word edits flip too many bits. */
export const SIMHASH_MIN_WORDS = 50;

function fnv1a64(str: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}

/**
 * Compute the 64-bit simhash of a text as 16 hex chars.
 * Returns null when the text has too few words to fingerprint reliably.
 */
export function simhash64(text: string): string | null {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length < SIMHASH_MIN_WORDS) return null;

  const votes = new Array<number>(64).fill(0);
  for (let i = 0; i < words.length - 1; i++) {
    const hash = fnv1a64(words[i] + ' ' + words[i + 1]);
    for (let bit = 0; bit < 64; bit++) {
      votes[bit] += (hash >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (votes[bit] > 0) fingerprint |= 1n << BigInt(bit);
  }
  return fingerprint.toString(16).padStart(16, '0');
}

/** Hamming distance between two 16-hex-char fingerprints (0–64). */
export function hammingDistanceHex(a: string, b: string): number {
  let distance = 0;
  // Compare in 8-hex-char (32-bit) halves so plain Number bitwise ops suffice.
  for (let i = 0; i < 16; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) {
      x &= x - 1;
      distance++;
    }
  }
  return distance;
}
