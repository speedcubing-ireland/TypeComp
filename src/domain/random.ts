const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const RANDOM_STATE_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4_294_967_296;

function hashSeed(seed: string | number): number {
  const value = String(seed);
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function seededRandom(seed: string | number): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += RANDOM_STATE_INCREMENT;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function shuffled<T>(values: readonly T[], seed: string | number): T[] {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const currentValue = result[index] as T;
    result[index] = result[other] as T;
    result[other] = currentValue;
  }
  return result;
}
