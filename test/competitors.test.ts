import { describe, expect, test } from 'bun:test';
import {
  balancedMatchingStrategy,
  CompetitionSession,
  group,
  groupsForRound,
  personalBest,
  preference,
  requireGroups,
  sameCountry,
} from '../src/index';
import { activity, competitionFixture } from './fixture';

function competitorAssignments(session: CompetitionSession) {
  return session
    .export()
    .persons.flatMap((person) =>
      (person.assignments ?? [])
        .filter((assignment) => assignment.assignmentCode === 'competitor')
        .map((assignment) => ({ person, assignment })),
    );
}

describe('competitor planning', () => {
  test('satisfies hard constraints, balances groups, and optimizes preferences', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    session.round('333-r1').createGroups({ count: 2 });
    const summary = await session.round('333-r1').assignCompetitors({
      constraints: [
        requireGroups(
          'first competitor opens group one',
          (person) => person.registrantId === 1,
          group(1),
        ),
      ],
      preferences: [sameCountry(10)],
      stationOrder: (person) => personalBest(person, '333') ?? Infinity,
      seed: 'repeatable',
    });

    expect(summary).toEqual({ assigned: 8, activities: 2 });
    const groups = groupsForRound(session.export(), '333-r1');
    const assignments = competitorAssignments(session);
    const sizes = groups.map(
      (current) =>
        assignments.filter(({ assignment }) => assignment.activityId === current.id)
          .length,
    );
    expect(sizes).toEqual([4, 4]);

    const firstPerson = assignments.find(({ person }) => person.registrantId === 1);
    expect(firstPerson?.assignment.activityId).toBe(groups[0]?.id);
    for (const current of groups) {
      const countries = new Set(
        assignments
          .filter(({ assignment }) => assignment.activityId === current.id)
          .map(({ person }) => person.countryIso2),
      );
      expect(countries.size).toBe(1);
      const stations = assignments
        .filter(({ assignment }) => assignment.activityId === current.id)
        .map(({ assignment }) => assignment.stationNumber)
        .sort();
      expect(stations).toEqual([1, 2, 3, 4]);
    }
  });

  test('fails atomically when constraints are impossible', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    session.round('333-r1').createGroups({ count: 2 });
    const before = session.export().persons;

    await expect(
      session.round('333-r1').assignCompetitors({
        constraints: [requireGroups('everyone in group one', () => true, group(1))],
      }),
    ).rejects.toThrow('hard constraints');
    expect(session.export().persons).toEqual(before);
    expect(session.changedSections).toEqual(new Set(['schedule']));
  });

  test('uses synchronized target-round results for later-round entrants', async () => {
    const competition = competitionFixture();
    const secondRound = competition.events[0]?.rounds[1];
    if (!secondRound) throw new Error('Fixture is missing round two.');
    secondRound.results = [
      { personId: 2, ranking: null, attempts: [], best: 0, average: 0 },
      { personId: 7, ranking: null, attempts: [], best: 0, average: 0 },
    ];
    const session = CompetitionSession.fromCompetition(competition);
    session.round('333-r2').createGroups({ count: 1 });
    await session.round('333-r2').assignCompetitors();

    expect(
      competitorAssignments(session)
        .map(({ person }) => person.registrantId)
        .sort(),
    ).toEqual([2, 7]);
  });

  test('refuses to guess later-round entrants before live results are synchronized', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    session.round('333-r2').createGroups({ count: 1 });
    await expect(session.round('333-r2').assignCompetitors()).rejects.toThrow(
      'no live-result entrants',
    );
  });

  test('rejects an invalid custom strategy before mutating assignments', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    const before = session.export().persons;
    await expect(
      round.assignCompetitors({
        strategy: {
          solve: ({ groups, people }) => {
            const first = groups[0];
            const person = people[0];
            if (person) person.name = 'Mutation from custom strategy';
            return first ? new Map([[first, people.slice(0, 2)]]) : new Map();
          },
        },
      }),
    ).rejects.toThrow('incomplete allocation');
    expect(session.export().persons).toEqual(before);
  });

  test('enforces custom strategy group and capacity boundaries', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    const before = session.export().persons;

    await expect(
      round.assignCompetitors({
        strategy: {
          solve: ({ groups, people }) => {
            const first = groups[0];
            if (!first) return new Map();
            return new Map([[structuredClone(first), people]]);
          },
        },
      }),
    ).rejects.toThrow('unknown group');
    await expect(
      round.assignCompetitors({
        maxGroupSize: 4,
        strategy: {
          solve: ({ groups, people }) => {
            const first = groups[0];
            return first ? new Map([[first, people]]) : new Map();
          },
        },
      }),
    ).rejects.toThrow('maximum group size');
    expect(session.export().persons).toEqual(before);
  });

  test('isolates user callbacks from non-assignment WCIF state', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    await round.assignCompetitors({
      preferences: [
        preference('attempted mutation', (person) => {
          person.name = 'Mutated by preference';
          return 0;
        }),
      ],
    });
    expect(
      session.export().persons.some((person) => person.name === 'Mutated by preference'),
    ).toBe(false);
  });

  test('supports asynchronous optimization strategies', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    const summary = await round.assignCompetitors({
      strategy: {
        solve: async (problem) => balancedMatchingStrategy.solve(problem),
      },
    });
    expect(summary.assigned).toBe(8);
  });

  test('treats existing staff work as a hard scheduling conflict', async () => {
    const competition = competitionFixture();
    const room = competition.schedule.venues[0]?.rooms[0];
    const firstPerson = competition.persons[0];
    if (!room || !firstPerson) throw new Error('Fixture is incomplete.');
    room.activities.push(
      activity(99, 'other-setup', '2026-10-03T09:00:00.000Z', '2026-10-03T10:00:00.000Z'),
    );
    firstPerson.assignments?.push({
      activityId: 99,
      assignmentCode: 'staff-runner',
      stationNumber: null,
    });
    const session = CompetitionSession.fromCompetition(competition);
    session.round('333-r1').createGroups({ count: 2 });

    await expect(session.round('333-r1').assignCompetitors()).rejects.toThrow(
      'hard constraints',
    );
  });

  test('rejects invalid optimization bounds before planning', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    session.round('333-r1').createGroups({ count: 2 });
    await expect(
      session.round('333-r1').assignCompetitors({ maxGroupSize: Number.NaN }),
    ).rejects.toThrow('maximum group size');
    await expect(
      session.round('333-r1').assignCompetitors({ improvementPasses: -1 }),
    ).rejects.toThrow('Improvement passes');
    await expect(
      session.round('333-r1').assignCompetitors({ stationOrder: () => Number.NaN }),
    ).rejects.toThrow('station order');
    await expect(
      session.round('333-r1').assignCompetitors({
        preferences: [preference('overflow', () => Number.MAX_VALUE, 2)],
      }),
    ).rejects.toThrow('non-finite score');
  });

  test('does not treat an empty selection as a destructive clear operation', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    await round.assignCompetitors();
    const before = session.export().persons;
    await expect(round.assignCompetitors({ select: () => false })).rejects.toThrow(
      'No competitors were selected',
    );
    expect(session.export().persons).toEqual(before);
  });
});
