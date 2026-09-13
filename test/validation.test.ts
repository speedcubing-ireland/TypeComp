import { describe, expect, test } from 'bun:test';
import {
  type Competition,
  CompetitionSession,
  groupsForRound,
  validateCompetition,
} from '../src/index';
import { activity, competitionFixture } from './fixture';

function addParallelEvent(competition: Competition): void {
  const sourceEvent = competition.events[0];
  if (!sourceEvent) throw new Error('Fixture has no event.');
  const parallelEvent = structuredClone(sourceEvent);
  parallelEvent.id = '222';
  parallelEvent.rounds = parallelEvent.rounds.slice(0, 1);
  const parallelRound = parallelEvent.rounds[0];
  if (!parallelRound) throw new Error('Fixture has no round.');
  parallelRound.id = '222-r1';
  competition.events.push(parallelEvent);
}

describe('validation', () => {
  test('reports structural errors with stable codes and paths', () => {
    const competition = competitionFixture();
    competition.persons[0]?.assignments?.push({
      activityId: 999,
      assignmentCode: 'competitor',
      stationNumber: 0,
    });
    const issues = validateCompetition(competition);

    expect(issues.map((issue) => issue.code)).toEqual([
      'ORPHAN_ASSIGNMENT',
      'INVALID_STATION',
    ]);
    expect(issues[0]?.path).toBe('persons[1].assignments[0]');
  });

  test('accepts a clean WCIF fixture', () => {
    expect(validateCompetition(competitionFixture())).toEqual([]);
  });

  test('rejects unsupported WCIF versions', () => {
    const competition = competitionFixture();
    competition.formatVersion = '1.3';
    expect(validateCompetition(competition).map((issue) => issue.code)).toContain(
      'UNSUPPORTED_FORMAT_VERSION',
    );
  });

  test('requires positive integer activity ids', () => {
    const competition = competitionFixture();
    const activity = competition.schedule.venues
      .flatMap((venue) => venue.rooms)
      .flatMap((room) => room.activities)[0];
    if (!activity) throw new Error('Fixture has no activity.');
    activity.id = 0;
    expect(validateCompetition(competition).map((issue) => issue.code)).toContain(
      'INVALID_ACTIVITY_ID',
    );
  });

  test('detects competing and staffing in the same time window', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    session.round('333-r1').createGroups({ count: 2 });
    const competition = session.export();
    const groupId = groupsForRound(competition, '333-r1')[0]?.id;
    if (!groupId) throw new Error('Fixture has no group.');
    competition.persons[0]?.assignments?.push(
      { activityId: groupId, assignmentCode: 'competitor', stationNumber: 1 },
      { activityId: groupId, assignmentCode: 'staff-judge', stationNumber: 1 },
    );
    expect(validateCompetition(competition).map((issue) => issue.code)).toContain(
      'ASSIGNMENT_TIME_CONFLICT',
    );
  });

  test('warns about overlapping competitor assignments used by parallel waves', () => {
    const competition = competitionFixture();
    const room = competition.schedule.venues[0]?.rooms[0];
    const anchor = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    if (!room || !anchor) throw new Error('Fixture is incomplete.');
    addParallelEvent(competition);
    anchor.activityCode = '333-r1-g1';
    room.activities.push(
      activity(99, '222-r1-g1', '2026-10-03T09:00:00.000Z', '2026-10-03T10:00:00.000Z'),
    );
    competition.persons[0]?.assignments?.push(
      { activityId: 1, assignmentCode: 'competitor', stationNumber: 1 },
      { activityId: 99, assignmentCode: 'competitor', stationNumber: 1 },
    );

    const issues = validateCompetition(competition);
    expect(
      issues.find((issue) => issue.code === 'OVERLAPPING_COMPETITOR_ASSIGNMENTS')
        ?.severity,
    ).toBe('warning');
    expect(issues.some((issue) => issue.code === 'ASSIGNMENT_TIME_CONFLICT')).toBe(false);
  });

  test('rejects overlapping competitor groups that are not an aligned wave', () => {
    const competition = competitionFixture();
    const room = competition.schedule.venues[0]?.rooms[0];
    const anchor = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    if (!room || !anchor) throw new Error('Fixture is incomplete.');
    addParallelEvent(competition);
    anchor.activityCode = '333-r1-g1';
    room.activities.push(
      activity(99, '222-r1-g2', '2026-10-03T09:30:00.000Z', '2026-10-03T10:30:00.000Z'),
    );
    competition.persons[0]?.assignments?.push(
      { activityId: 1, assignmentCode: 'competitor', stationNumber: 1 },
      { activityId: 99, assignmentCode: 'competitor', stationNumber: 1 },
    );

    expect(validateCompetition(competition).map((issue) => issue.code)).toContain(
      'ASSIGNMENT_TIME_CONFLICT',
    );
  });

  test('rejects multiple competitor assignments in the same activity', () => {
    const competition = competitionFixture();
    competition.persons[0]?.assignments?.push(
      { activityId: 1, assignmentCode: 'competitor', stationNumber: 1 },
      { activityId: 1, assignmentCode: 'competitor', stationNumber: 2 },
    );

    const issues = validateCompetition(competition);
    expect(
      issues.find((issue) => issue.code === 'ASSIGNMENT_TIME_CONFLICT')?.severity,
    ).toBe('error');
    expect(
      issues.some((issue) => issue.code === 'OVERLAPPING_COMPETITOR_ASSIGNMENTS'),
    ).toBe(false);
  });

  test('rejects non-integer and duplicate station assignments', () => {
    const competition = competitionFixture();
    competition.persons[0]?.assignments?.push({
      activityId: 1,
      assignmentCode: 'staff-judge',
      stationNumber: 1.5,
    });
    competition.persons[1]?.assignments?.push({
      activityId: 1,
      assignmentCode: 'staff-judge',
      stationNumber: 2,
    });
    competition.persons[2]?.assignments?.push({
      activityId: 1,
      assignmentCode: 'staff-judge',
      stationNumber: 2,
    });
    const codes = validateCompetition(competition).map((issue) => issue.code);
    expect(codes).toContain('INVALID_STATION');
    expect(codes).toContain('DUPLICATE_STATION');
  });

  test('accepts null registrant ids but rejects duplicate person identities', () => {
    const competition = competitionFixture();
    const template = competition.persons[0];
    if (!template) throw new Error('Fixture has no people.');
    competition.persons.push(
      {
        ...structuredClone(template),
        registrantId: null,
        wcaUserId: 100,
        registration: null,
      },
      {
        ...structuredClone(template),
        registrantId: null,
        wcaUserId: 100,
        registration: null,
      },
    );
    expect(validateCompetition(competition).map((issue) => issue.code)).toContain(
      'DUPLICATE_PERSON_ID',
    );
  });

  test('requires child activities to remain inside their parent time range', () => {
    const competition = competitionFixture();
    const parent = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    if (!parent) throw new Error('Fixture is missing a round activity.');
    parent.childActivities.push({
      id: 3,
      activityCode: '333-r1-g1',
      name: 'Outside group',
      startTime: '2026-10-03T08:30:00.000Z',
      endTime: '2026-10-03T09:30:00.000Z',
      childActivities: [],
      extensions: [],
    });
    expect(validateCompetition(competition).map((issue) => issue.code)).toContain(
      'CHILD_OUTSIDE_PARENT',
    );
  });

  test('validates round references and nested activity codes', () => {
    const competition = competitionFixture();
    const parent = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    if (!parent) throw new Error('Fixture is missing a round activity.');
    parent.childActivities.push({
      id: 3,
      activityCode: '333-r2-g1',
      name: 'Wrong round',
      startTime: '2026-10-03T09:00:00.000Z',
      endTime: '2026-10-03T09:30:00.000Z',
      childActivities: [],
      extensions: [],
    });
    parent.childActivities.push({
      id: 4,
      activityCode: '222-r1-g1',
      name: 'Missing event',
      startTime: '2026-10-03T09:30:00.000Z',
      endTime: '2026-10-03T10:00:00.000Z',
      childActivities: [],
      extensions: [],
    });
    const codes = validateCompetition(competition).map((issue) => issue.code);
    expect(codes).toContain('INVALID_ACTIVITY_NESTING');
    expect(codes).toContain('ORPHAN_ROUND_ACTIVITY');
  });
});
