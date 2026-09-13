import { describe, expect, test } from 'bun:test';
import { groupifierOrder, groupifierStrategy } from '../examples/groupifier/competitors';
import type { GroupifierOptions } from '../examples/groupifier/config';
import { planLikeGroupifier } from '../examples/groupifier/plan';
import { selectStaff } from '../examples/groupifier/staff';
import {
  assignmentsForActivity,
  CompetitionSession,
  findActivity,
  groupsForRound,
  schedulablePeople,
} from '../src/index';
import { activity, competitionFixture } from './fixture';

const ASSIGNMENT_OPTIONS = {
  competitorSortingRule: 'ranks',
  noTasksForNewcomers: false,
  tasksForOwnEventsOnly: false,
  noRunningForForeigners: false,
  printStations: false,
} as const;

function personAt(competition: ReturnType<typeof competitionFixture>, index: number) {
  const person = competition.persons[index];
  if (!person) throw new Error(`Fixture has no person at index ${index}.`);
  return person;
}

describe('Groupifier-compatible example', () => {
  test('implements every competitor ordering mode', () => {
    const competition = competitionFixture();
    const people = schedulablePeople(competition);
    const ids = (rule: GroupifierOptions['assignments']['competitorSortingRule']) =>
      groupifierOrder(competition, '333-r1', people, rule, 2).map(
        (person) => person.registrantId,
      );

    expect(ids('ranks')).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(ids('balanced')).toEqual(ids('ranks'));
    expect(ids('symmetric')).toEqual([8, 6, 4, 2, 7, 5, 3, 1]);

    personAt(competition, 0).name = 'Alex One';
    personAt(competition, 1).name = 'Alex Two';
    personAt(competition, 2).name = 'Alex Three';
    const optimized = ids('name-optimised');
    expect(optimized).toHaveLength(people.length);
    expect(new Set(optimized).size).toBe(people.length);
  });

  test('uses availability and role coverage during greedy grouping', async () => {
    const competition = competitionFixture();
    const side = competition.schedule.venues[0]?.rooms[0];
    const unavailable = competition.persons[7];
    if (!side || !unavailable) throw new Error('Fixture is incomplete.');
    side.activities.push(
      activity(99, 'other-block', '2026-10-03T09:00:00.000Z', '2026-10-03T09:30:00.000Z'),
    );
    unavailable.assignments?.push({
      activityId: 99,
      assignmentCode: 'staff-other',
      stationNumber: null,
    });
    unavailable.roles = ['delegate'];
    personAt(competition, 6).roles = ['delegate'];
    const session = CompetitionSession.fromCompetition(competition);
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });

    await round.assignCompetitors({
      strategy: groupifierStrategy('333-r1', 'ranks', new Map([[1, 1]])),
      allowOverlap: () => true,
    });

    const groups = groupsForRound(session.export(), '333-r1');
    const assignment = session
      .export()
      .persons[7]?.assignments?.find(
        (candidate) => candidate.assignmentCode === 'competitor',
      );
    expect(assignment?.activityId).toBe(groups[1]?.id);
    const delegateGroups = session
      .export()
      .persons.slice(6)
      .map(
        (person) =>
          person.assignments?.find(
            (candidate) => candidate.assignmentCode === 'competitor',
          )?.activityId,
      );
    expect(new Set(delegateGroups).size).toBe(2);
  });

  test('honors capacity splits and disabled station printing', async () => {
    const competition = competitionFixture();
    const main = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    const side = competition.schedule.venues[0]?.rooms[0];
    if (!main || !side) throw new Error('Fixture is incomplete.');
    side.activities.push({ ...structuredClone(main), id: 99, childActivities: [] });
    const options = {
      assignments: ASSIGNMENT_OPTIONS,
      rooms: [
        { room: 'Main Stage', stations: 16 },
        { room: 'Side Stage', stations: 8 },
      ],
      rounds: [
        {
          roundId: '333-r1',
          activities: [
            {
              target: { room: 'Main Stage' },
              capacity: 0.75,
              groups: 1,
              scramblers: 0,
              runners: 0,
              assignJudges: false,
            },
            {
              target: { activityId: 99 },
              capacity: 0.25,
              groups: 1,
              scramblers: 0,
              runners: 0,
              assignJudges: false,
            },
          ],
        },
      ],
    } as const satisfies GroupifierOptions;
    const session = CompetitionSession.fromCompetition(competition);

    await planLikeGroupifier(session, options);

    const updated = session.export();
    const groups = groupsForRound(updated, '333-r1');
    expect(
      groups.map(
        (group) =>
          assignmentsForActivity(updated, group.id).filter(
            ({ assignment }) => assignment.assignmentCode === 'competitor',
          ).length,
      ),
    ).toEqual([2, 6]);
    expect(
      updated.persons
        .flatMap((person) => person.assignments ?? [])
        .filter((assignment) => assignment.assignmentCode === 'competitor')
        .every((assignment) => assignment.stationNumber === null),
    ).toBe(true);
  });

  test('applies task eligibility flags after designated staff', () => {
    const competition = competitionFixture();
    for (const person of competition.persons) {
      person.birthdate = '2000-01-01';
      if (person.registration) person.registration.status = 'pending';
    }
    const newcomer = personAt(competition, 0);
    const wrongEvent = personAt(competition, 1);
    const ideal = personAt(competition, 2);
    const foreigner = personAt(competition, 4);
    for (const person of [newcomer, wrongEvent, ideal, foreigner]) {
      if (person.registration) person.registration.status = 'accepted';
    }
    newcomer.wcaId = null;
    if (wrongEvent.registration) wrongEvent.registration.eventIds = ['222'];
    const activity = findActivity(competition, 1)?.activity;
    if (!activity) throw new Error('Fixture has no activity.');
    const strict = {
      ...ASSIGNMENT_OPTIONS,
      noTasksForNewcomers: true,
      tasksForOwnEventsOnly: true,
      noRunningForForeigners: true,
    };
    const competitors = new Set([1, 2, 3, 5]);

    expect(
      selectStaff(competition, activity, '333', 'staff-runner', 4, strict, competitors)[0]
        ?.registrantId,
    ).toBe(ideal.registrantId);

    foreigner.roles = ['staff-runner'];
    expect(
      selectStaff(competition, activity, '333', 'staff-runner', 1, strict, competitors)[0]
        ?.registrantId,
    ).toBe(foreigner.registrantId);
  });

  test('uses only round entrants as fallback scramblers', () => {
    const competition = competitionFixture();
    const activity = findActivity(competition, 1)?.activity;
    if (!activity) throw new Error('Fixture has no activity.');

    const selected = selectStaff(
      competition,
      activity,
      '333',
      'staff-scrambler',
      8,
      ASSIGNMENT_OPTIONS,
      new Set([1, 2]),
    );

    expect(selected.map((person) => person.registrantId)).toEqual([1, 2]);
  });

  test('rejects invalid static configuration without changing the session', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const before = session.export();
    const invalid = {
      assignments: ASSIGNMENT_OPTIONS,
      rooms: [{ room: 'Main Stage', stations: 16 }],
      rounds: [
        {
          roundId: '333-r1',
          activities: [
            {
              target: { room: 'Main Stage' },
              capacity: 0.5,
              groups: 2,
              scramblers: 1,
              runners: 1,
              assignJudges: true,
            },
          ],
        },
      ],
    } as const satisfies GroupifierOptions;

    await expect(planLikeGroupifier(session, invalid)).rejects.toThrow('add up to one');
    expect(session.export()).toEqual(before);
  });

  test('rolls back group creation when assignment fails later', async () => {
    const competition = competitionFixture();
    competition.persons[0]?.assignments?.push({
      activityId: 999,
      assignmentCode: 'staff-other',
      stationNumber: null,
    });
    const session = CompetitionSession.fromCompetition(competition);
    const before = session.export();
    const options = {
      assignments: ASSIGNMENT_OPTIONS,
      rooms: [{ room: 'Main Stage', stations: 16 }],
      rounds: [
        {
          roundId: '333-r1',
          activities: [
            {
              target: { room: 'Main Stage' },
              capacity: 1,
              groups: 2,
              scramblers: 1,
              runners: 1,
              assignJudges: true,
            },
          ],
        },
      ],
    } as const satisfies GroupifierOptions;

    await expect(planLikeGroupifier(session, options)).rejects.toThrow(
      'missing activity 999',
    );
    expect(session.export()).toEqual(before);
  });
});
