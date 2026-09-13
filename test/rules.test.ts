import { describe, expect, test } from 'bun:test';
import {
  accepted,
  and,
  CompetitionSession,
  differentFirstNames,
  excludeGroups,
  fromCountry,
  group,
  groupsForRound,
  hasPersonalBest,
  hasRole,
  matching,
  namedGroup,
  not,
  or,
  personalBest,
  preferFaster,
  preferRole,
  registeredFor,
  requireGroups,
  sameCountry,
  schedulablePeople,
  staffConstraint,
} from '../src/index';
import { competitionFixture } from './fixture';

describe('declarative rules', () => {
  test('composes person and group predicates', () => {
    const competition = competitionFixture();
    const first = schedulablePeople(competition)[0];
    if (!first) throw new Error('Fixture has no people.');
    first.roles = ['delegate'];

    expect(accepted(first)).toBe(true);
    expect(registeredFor('333')(first)).toBe(true);
    expect(fromCountry('ie')(first)).toBe(true);
    expect(hasPersonalBest('333', 'average')(first)).toBe(true);
    expect(hasRole('delegate')(first)).toBe(true);
    expect(and(accepted, fromCountry('IE'))(first)).toBe(true);
    expect(or(fromCountry('GB'), hasRole('delegate'))(first)).toBe(true);
    expect(not(fromCountry('GB'))(first)).toBe(true);

    const session = CompetitionSession.fromCompetition(competition);
    session.round('333-r1').createGroups({ count: 2 });
    const groups = groupsForRound(session.export(), '333-r1');
    expect(groups.filter(group(1))).toHaveLength(1);
    expect(groups.filter(namedGroup('main stage'))).toHaveLength(2);
  });

  test('keeps hard placement rules explicit', () => {
    const competition = competitionFixture();
    const session = CompetitionSession.fromCompetition(competition);
    session.round('333-r1').createGroups({ count: 2 });
    const [firstGroup, secondGroup] = groupsForRound(session.export(), '333-r1');
    const firstPerson = schedulablePeople(competition)[0];
    const secondPerson = schedulablePeople(competition)[1];
    if (!firstGroup || !secondGroup || !firstPerson || !secondPerson) {
      throw new Error('Fixture is incomplete.');
    }

    const required = requireGroups(
      'first person in group one',
      (person) => person.registrantId === 1,
      group(1),
    );
    const excluded = excludeGroups(
      'second person out of group two',
      (person) => person.registrantId === 2,
      group(2),
    );
    expect(required.allows(firstPerson, firstGroup, competition)).toBe(true);
    expect(required.allows(firstPerson, secondGroup, competition)).toBe(false);
    expect(required.allows(secondPerson, secondGroup, competition)).toBe(true);
    expect(excluded.allows(secondPerson, secondGroup, competition)).toBe(false);

    const custom = staffConstraint(
      'delegates only',
      (person) => person.roles?.includes('delegate') ?? false,
    );
    expect(custom.name).toBe('delegates only');
  });

  test('scores group composition and staff candidates predictably', () => {
    const competition = competitionFixture();
    const people = schedulablePeople(competition);
    const irish = people[0];
    const anotherIrish = people[1];
    const british = people[4];
    const groupActivity = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    if (!irish || !anotherIrish || !british || !groupActivity) {
      throw new Error('Fixture is incomplete.');
    }
    irish.roles = ['delegate'];
    const context = {
      competition,
      group: groupActivity,
      members: [anotherIrish, british],
    };

    expect(personalBest(irish, '333')).toBe(1_100);
    expect(sameCountry(3).score(irish, context)).toBe(1);
    expect(differentFirstNames().score(irish, context)).toBe(-1);
    expect(matching((person) => person.countryIso2).score(irish, context)).toBe(1);
    expect(
      preferRole('delegate')(irish, {
        competition,
        activity: groupActivity,
        assignmentCode: 'staff-judge',
        stationNumber: null,
        assignmentCount: 0,
      }),
    ).toBe(100);
    expect(
      preferFaster('333')(irish, {
        competition,
        activity: groupActivity,
        assignmentCode: 'staff-scrambler',
        stationNumber: null,
        assignmentCount: 0,
      }),
    ).toBe(-1_100);
    expect(() => preferFaster('333', 'average', -1)).toThrow('non-negative');
    expect(
      preferFaster('222')(irish, {
        competition,
        activity: groupActivity,
        assignmentCode: 'staff-scrambler',
        stationNumber: null,
        assignmentCount: 0,
      }),
    ).toBe(-Number.MAX_SAFE_INTEGER);
  });
});
