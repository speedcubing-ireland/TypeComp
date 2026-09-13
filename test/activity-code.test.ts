import { describe, expect, test } from 'bun:test';
import { groupCode, parseActivityCode, parseRoundId } from '../src/index';

describe('activity codes', () => {
  test('parses round, group, and attempt components', () => {
    expect(parseActivityCode('333-r2-g4-a1')).toEqual({
      eventId: '333',
      roundNumber: 2,
      groupNumber: 4,
      attemptNumber: 1,
    });
    expect(parseActivityCode('not-an-activity')).toBeNull();
  });

  test('rejects group codes where a round id is required', () => {
    expect(() => parseRoundId('333-r1-g1')).toThrow('Invalid round id');
    expect(groupCode('333-r1', 3)).toBe('333-r1-g3');
  });
});
