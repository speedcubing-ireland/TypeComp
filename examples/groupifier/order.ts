export type OrderValue = number | string;
export type OrderKey = readonly OrderValue[];

function compareValue(first: OrderValue, second: OrderValue): number {
  if (typeof first === 'number' && typeof second === 'number') {
    return first < second ? -1 : first > second ? 1 : 0;
  }
  const left = String(first);
  const right = String(second);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function orderBy<T>(values: readonly T[], key: (value: T) => OrderKey): T[] {
  return values
    .map((value, index) => ({ value, index, key: key(value) }))
    .sort((first, second) => {
      const length = Math.min(first.key.length, second.key.length);
      for (let index = 0; index < length; index += 1) {
        const left = first.key[index];
        const right = second.key[index];
        if (left === undefined || right === undefined) break;
        const comparison = compareValue(left, right);
        if (comparison !== 0) return comparison;
      }
      return first.key.length - second.key.length || first.index - second.index;
    })
    .map(({ value }) => value);
}
