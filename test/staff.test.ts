import { describe, expect, test } from 'bun:test';
import { CompetitionSession, hasRole, personalBest, preferFaster } from '../src/index';
import { activity, competitionFixture } from './fixture';

describe('staff planning', () => {
  test('assigns staff to non-group activities through the session boundary', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const summary = session.activity(1).assignStaff({
      roles: [{ assignmentCode: 'staff-announcer', count: 1 }],
      seed: 'announcer',
    });
    expect(summary.assigned).toBe(1);
    expect(session.changedSections).toEqual(new Set(['persons']));
  });

  test('fills typed roles without assigning competitors to their own group', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    await round.assignCompetitors({
      stationOrder: (person) => personalBest(person, '333') ?? Infinity,
    });
    const summary = round.assignStaff({
      roles: [
        { assignmentCode: 'staff-judge', count: 1, stations: true },
        {
          assignmentCode: 'staff-scrambler',
          count: 1,
          eligible: (person) => personalBest(person, '333') !== null,
        },
      ],
      preferences: [preferFaster('333')],
      seed: 'staff',
    });

    expect(summary.assigned).toBe(4);
    const people = session.export().persons;
    for (const person of people) {
      const assignments = person.assignments ?? [];
      const competing = new Set(
        assignments
          .filter((assignment) => assignment.assignmentCode === 'competitor')
          .map((assignment) => assignment.activityId),
      );
      expect(
        assignments.some(
          (assignment) =>
            assignment.assignmentCode.startsWith('staff-') &&
            competing.has(assignment.activityId),
        ),
      ).toBe(false);
    }
  });

  test('does not apply a partial plan', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    const before = session.export().persons;

    expect(() =>
      round.assignStaff({ roles: [{ assignmentCode: 'staff-judge', count: 20 }] }),
    ).toThrow('slots');
    expect(session.export().persons).toEqual(before);
  });

  test('rejects missing roles and invalid load penalties', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    expect(() =>
      session.activity(1).assignStaff({
        roles: [],
      }),
    ).toThrow('At least one staff role');
    expect(() =>
      session.activity(1).assignStaff({
        roles: [{ assignmentCode: 'staff-judge', count: 1 }],
        loadPenalty: -1,
      }),
    ).toThrow('load penalty');
  });

  test('can replace one staff role without discarding other roles', () => {
    const competition = competitionFixture();
    competition.persons[0]?.assignments?.push(
      {
        activityId: 1,
        assignmentCode: 'staff-scrambler',
        stationNumber: null,
      },
      {
        activityId: 1,
        assignmentCode: 'staff-runner',
        stationNumber: null,
      },
    );
    const session = CompetitionSession.fromCompetition(competition);

    const summary = session.activity(1).assignStaff({
      roles: [{ assignmentCode: 'staff-runner', count: 0 }],
      replaceExisting: 'same-roles',
    });

    expect(summary).toEqual({ assigned: 0, activities: 1 });
    expect(session.export().persons[0]?.assignments).toEqual([
      {
        activityId: 1,
        assignmentCode: 'staff-scrambler',
        stationNumber: null,
      },
    ]);
  });

  test('balances new work against existing staff assignments', () => {
    const competition = competitionFixture();
    competition.persons[0]?.assignments?.push({
      activityId: 1,
      assignmentCode: 'staff-announcer',
      stationNumber: null,
    });
    const session = CompetitionSession.fromCompetition(competition);
    session.activity(2).assignStaff({
      roles: [{ assignmentCode: 'staff-runner', count: 1 }],
      select: (person) => person.registrantId === 1 || person.registrantId === 2,
      seed: 1,
    });
    const assigned = session
      .export()
      .persons.find((person) => person.registrantId === 2)
      ?.assignments?.some(
        (assignment) =>
          assignment.activityId === 2 && assignment.assignmentCode === 'staff-runner',
      );
    expect(assigned).toBe(true);
  });

  test('plans scarce parallel activities before flexible ones', () => {
    const competition = competitionFixture();
    const parent = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    if (!parent) throw new Error('Fixture is missing a round activity.');
    const firstGroup = activity(
      3,
      '333-r1-g1',
      '2026-10-03T09:00:00.000Z',
      '2026-10-03T10:00:00.000Z',
    );
    const secondGroup = activity(
      4,
      '333-r1-g2',
      '2026-10-03T09:00:00.000Z',
      '2026-10-03T10:00:00.000Z',
    );
    parent.childActivities = [firstGroup, secondGroup];
    const session = CompetitionSession.fromCompetition(competition);

    const summary = session.round('333-r1').assignStaff({
      roles: [{ assignmentCode: 'staff-judge', count: 1 }],
      select: (person) => person.registrantId === 1 || person.registrantId === 2,
      constraints: [
        {
          name: 'second group specialist',
          allows: (person, group) =>
            group.id !== secondGroup.id || person.registrantId === 1,
        },
      ],
      seed: 1,
    });

    expect(summary.assigned).toBe(2);
    const assignments = session
      .export()
      .persons.flatMap((person) =>
        (person.assignments ?? []).map((assignment) => ({ person, assignment })),
      );
    expect(
      assignments.find(({ assignment }) => assignment.activityId === secondGroup.id)
        ?.person.registrantId,
    ).toBe(1);
    expect(
      assignments.find(({ assignment }) => assignment.activityId === firstGroup.id)
        ?.person.registrantId,
    ).toBe(2);
  });

  test('can replace staff work for organizers without registrant ids', () => {
    const competition = competitionFixture();
    const template = competition.persons[0];
    if (!template) throw new Error('Fixture has no people.');
    competition.persons.push({
      ...structuredClone(template),
      registrantId: null,
      wcaUserId: 100,
      name: 'Organizer',
      roles: ['organizer'],
      registration: null,
      assignments: [
        {
          activityId: 1,
          assignmentCode: 'staff-runner',
          stationNumber: null,
        },
      ],
    });
    const session = CompetitionSession.fromCompetition(competition);
    session.activity(1).assignStaff({
      roles: [{ assignmentCode: 'staff-announcer', count: 1 }],
      select: hasRole('organizer'),
    });
    expect(session.export().persons.at(-1)?.assignments).toEqual([
      {
        activityId: 1,
        assignmentCode: 'staff-announcer',
        stationNumber: null,
      },
    ]);
  });
});
