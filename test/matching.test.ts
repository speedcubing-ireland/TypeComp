import { describe, expect, test } from 'bun:test';
import { InfeasibleAssignmentError } from '../src/index';
import { solveMatching } from '../src/solver/matching';

describe('exact matching', () => {
  test('reroutes earlier choices to satisfy constrained items', () => {
    const result = solveMatching({
      items: ['flexible', 'restricted'],
      bins: ['first', 'second'],
      capacities: [1, 1],
      constraints: [
        {
          name: 'restricted item uses first bin',
          allows: (item, bin) => item !== 'restricted' || bin === 'first',
        },
      ],
    });
    expect(result.get('restricted')).toBe('first');
    expect(result.get('flexible')).toBe('second');
  });

  test('maximizes total score rather than making a greedy first choice', () => {
    const scores = new Map([
      ['a:first', 10],
      ['a:second', 9],
      ['b:first', 8],
      ['b:second', 0],
    ]);
    const result = solveMatching({
      items: ['a', 'b'],
      bins: ['first', 'second'],
      capacities: [1, 1],
      score: (item, bin) => scores.get(`${item}:${bin}`) ?? 0,
    });
    expect(result.get('a')).toBe('second');
    expect(result.get('b')).toBe('first');
  });

  test('fails explicitly when hard constraints make an item impossible', () => {
    expect(() =>
      solveMatching({
        items: ['item'],
        bins: ['bin'],
        capacities: [1],
        constraints: [{ name: 'none allowed', allows: () => false }],
        describeItem: (item) => item,
      }),
    ).toThrow(InfeasibleAssignmentError);
  });
});
