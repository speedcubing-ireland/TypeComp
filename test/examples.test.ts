import { describe, expect, test } from 'bun:test';
import { planAroundExistingAssignments } from '../examples/availability';
import { planBasicRound } from '../examples/basic';
import { planByAge } from '../examples/custom-preferences';
import { GROUPIFIER_OPTIONS } from '../examples/groupifier/config';
import { planLikeGroupifier } from '../examples/groupifier/plan';
import { planLaterRound } from '../examples/later-round';
import { planParallelEvents } from '../examples/parallel-events';
import {
  assignmentsForActivity,
  CompetitionSession,
  findActivity,
  groupNumber,
  groupsForRound,
} from '../src/index';
import { activity, competitionFixture } from './fixture';

function competitionWithParallelRound(
  startTime = '2026-10-03T09:00:00.000Z',
  endTime = '2026-10-03T10:00:00.000Z',
) {
  const competition = competitionFixture();
  const sourceEvent = competition.events[0];
  const room = competition.schedule.venues[0]?.rooms[0];
  if (!sourceEvent || !room) throw new Error('Fixture is incomplete.');
  const parallelEvent = structuredClone(sourceEvent);
  parallelEvent.id = '222';
  parallelEvent.rounds = parallelEvent.rounds.slice(0, 1);
  const parallelRound = parallelEvent.rounds[0];
  if (!parallelRound) throw new Error('Fixture has no round.');
  parallelRound.id = '222-r1';
  competition.events.push(parallelEvent);
  room.activities.push(activity(3, '222-r1', startTime, endTime));
  for (const person of competition.persons.slice(0, 4)) {
    person.registration?.eventIds.push('222');
  }
  return competition;
}

describe('published examples', () => {
  test('reproduces the configured Groupifier assignment pipeline', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());

    const result = await planLikeGroupifier(session, GROUPIFIER_OPTIONS);

    expect(result).toEqual({ rounds: 1, competitors: 8, staff: 24 });
    const competition = session.export();
    const groups = groupsForRound(competition, '333-r1');
    expect(groups).toHaveLength(4);
    expect(
      groups.map((group) =>
        assignmentsForActivity(competition, group.id).map(
          ({ person, assignment }) =>
            `${person.registrantId}:${assignment.assignmentCode}:${assignment.stationNumber ?? '-'}`,
        ),
      ),
    ).toEqual([
      [
        '1:staff-runner:-',
        '2:staff-judge:-',
        '3:staff-scrambler:-',
        '4:staff-runner:-',
        '5:staff-scrambler:-',
        '6:staff-scrambler:-',
        '7:competitor:1',
        '8:competitor:2',
      ],
      [
        '1:staff-runner:-',
        '2:staff-runner:-',
        '3:staff-scrambler:-',
        '4:staff-judge:-',
        '5:competitor:1',
        '6:competitor:2',
        '7:staff-scrambler:-',
        '8:staff-scrambler:-',
      ],
      [
        '1:staff-judge:-',
        '2:staff-runner:-',
        '3:competitor:1',
        '4:competitor:2',
        '5:staff-scrambler:-',
        '6:staff-scrambler:-',
        '7:staff-scrambler:-',
        '8:staff-runner:-',
      ],
      [
        '1:competitor:1',
        '2:competitor:2',
        '3:staff-scrambler:-',
        '4:staff-scrambler:-',
        '5:staff-runner:-',
        '6:staff-runner:-',
        '7:staff-judge:-',
        '8:staff-scrambler:-',
      ],
    ]);
    expect(session.validate()).toEqual([]);
  });

  test('assigns every distributed attempt without creating groups or staff', async () => {
    const competition = competitionFixture();
    const sourceEvent = competition.events[0];
    const side = competition.schedule.venues[0]?.rooms[0];
    const main = competition.schedule.venues[1]?.rooms[0];
    if (!sourceEvent || !side || !main) throw new Error('Fixture is incomplete.');
    const event = structuredClone(sourceEvent);
    event.id = '333fm';
    event.rounds = event.rounds.slice(0, 1);
    const round = event.rounds[0];
    if (!round) throw new Error('Fixture has no round.');
    round.id = '333fm-r1';
    competition.events.push(event);
    side.activities.push(
      activity(50, '333fm-r1-a1', '2026-10-03T11:00:00.000Z', '2026-10-03T11:30:00.000Z'),
      activity(52, '333fm-r1-a2', '2026-10-03T12:00:00.000Z', '2026-10-03T12:30:00.000Z'),
    );
    main.activities.push(
      activity(51, '333fm-r1-a1', '2026-10-03T11:00:00.000Z', '2026-10-03T11:30:00.000Z'),
      activity(53, '333fm-r1-a2', '2026-10-03T12:00:00.000Z', '2026-10-03T12:30:00.000Z'),
    );
    for (const person of competition.persons.slice(0, 4)) {
      person.registration?.eventIds.push('333fm');
    }
    const session = CompetitionSession.fromCompetition(competition);

    const result = await planLikeGroupifier(session, GROUPIFIER_OPTIONS);

    expect(result).toEqual({ rounds: 2, competitors: 16, staff: 24 });
    const updated = session.export();
    for (const activityId of [50, 51, 52, 53]) {
      expect(
        assignmentsForActivity(updated, activityId).filter(
          ({ assignment }) => assignment.assignmentCode === 'competitor',
        ),
      ).toHaveLength(2);
    }
    expect(
      updated.events.find((candidate) => candidate.id === '333fm')?.rounds[0]
        ?.scrambleSetCount,
    ).toBe(1);
    expect(session.validate()).toEqual([]);
  });

  test('runs the basic competitor and staff workflow', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const result = await planBasicRound(session, '333-r1', 4);

    expect(result.competitors).toEqual({ assigned: 8, activities: 4 });
    expect(result.staff).toEqual({ assigned: 12, activities: 4 });
    expect(session.validate()).toEqual([]);
    for (const group of session.round('333-r1').groups()) {
      expect(assignmentsForActivity(session.competition, group.id)).toHaveLength(5);
    }
  });

  test('runs custom preferences without mutating caller-visible state', async () => {
    const competition = competitionFixture();
    for (const [index, person] of competition.persons.entries()) {
      person.birthdate = `200${index}-01-01`;
    }
    const session = CompetitionSession.fromCompetition(competition);
    const result = await planByAge(session, '333-r1', 2);

    expect(result).toEqual({ assigned: 8, activities: 2 });
    const groups = session.round('333-r1').groups();
    const external = groups[0];
    if (!external) throw new Error('Example created no groups.');
    external.name = 'External mutation';
    expect(session.round('333-r1').groups()[0]?.name).not.toBe('External mutation');
    expect(session.validate()).toEqual([]);
  });

  test('uses existing assignments as hard availability constraints', async () => {
    const competition = competitionFixture();
    const room = competition.schedule.venues[0]?.rooms[0];
    const person = competition.persons[0];
    if (!room || !person) throw new Error('Fixture is incomplete.');
    room.activities.push(
      activity(99, 'other-setup', '2026-10-03T09:00:00.000Z', '2026-10-03T09:20:00.000Z'),
    );
    person.assignments?.push({
      activityId: 99,
      assignmentCode: 'staff-runner',
      stationNumber: null,
    });
    const session = CompetitionSession.fromCompetition(competition);

    await planAroundExistingAssignments(session, '333-r1', 3);

    const assignedGroupId = session.competition.persons[0]?.assignments?.find(
      (assignment) => assignment.assignmentCode === 'competitor',
    )?.activityId;
    const assignedGroup = findActivity(
      session.competition,
      assignedGroupId ?? -1,
    )?.activity;
    expect(assignedGroup?.startTime).not.toBe('2026-10-03T09:00:00.000Z');
    expect(session.validate()).toEqual([]);
  });

  test('uses synchronized result rows as later-round entrants', async () => {
    const competition = competitionFixture();
    const round = competition.events[0]?.rounds[1];
    if (!round) throw new Error('Fixture has no second round.');
    round.results = [
      { personId: 2, ranking: null, attempts: [], best: 0, average: 0 },
      { personId: 7, ranking: null, attempts: [], best: 0, average: 0 },
    ];
    const session = CompetitionSession.fromCompetition(competition);

    const result = await planLaterRound(session, '333-r2', 1);

    expect(result).toEqual({ assigned: 2, activities: 1 });
    expect(session.validate()).toEqual([]);
  });

  test('coordinates registered events into aligned parallel waves', async () => {
    const session = CompetitionSession.fromCompetition(competitionWithParallelRound());

    const result = await planParallelEvents(session, ['333-r1', '222-r1'], 2);

    expect(result).toEqual({ people: 8, waves: 2, assignments: 12 });
    const snapshot = session.competition;
    for (const person of snapshot.persons.slice(0, 4)) {
      const groups = (person.assignments ?? [])
        .filter((assignment) => assignment.assignmentCode === 'competitor')
        .map((assignment) => {
          const assigned = findActivity(snapshot, assignment.activityId)?.activity;
          return assigned ? groupNumber(assigned) : null;
        });
      expect(new Set(groups).size).toBe(1);
    }
    const issues = session.validate();
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
    expect(
      issues.some((issue) => issue.code === 'OVERLAPPING_COMPETITOR_ASSIGNMENTS'),
    ).toBe(true);
    expect(
      snapshot.events
        .filter((event) => event.id === '333' || event.id === '222')
        .map((event) => event.rounds[0]?.scrambleSetCount),
    ).toEqual([2, 2]);
  });

  test('requires at least two distinct parallel rounds', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const before = session.export();

    await expect(
      session.assignParallelRounds({ roundIds: ['333-r1'], groupCount: 2 }),
    ).rejects.toThrow('at least two distinct rounds');
    expect(session.export()).toEqual(before);
  });

  test('keeps the session unchanged when parallel windows are misaligned', async () => {
    const session = CompetitionSession.fromCompetition(
      competitionWithParallelRound(
        '2026-10-03T09:30:00.000Z',
        '2026-10-03T10:30:00.000Z',
      ),
    );
    const before = session.export();

    await expect(
      session.assignParallelRounds({
        roundIds: ['333-r1', '222-r1'],
        groupCount: 2,
      }),
    ).rejects.toThrow('aligned time windows');
    expect(session.export()).toEqual(before);
  });
});
