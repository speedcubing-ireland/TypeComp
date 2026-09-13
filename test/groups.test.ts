import { describe, expect, test } from 'bun:test';
import { activities, CompetitionSession, groupsForRound } from '../src/index';
import { activity, competitionFixture } from './fixture';

describe('group creation', () => {
  test('finds rooms across every venue and divides time exactly', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const result = session.round('333-r1').createGroups({ count: 3 });

    expect(result.room).toBe('Main Stage');
    expect(result.removedAssignments).toBe(0);
    expect(result.groups.map((group) => [group.startTime, group.endTime])).toEqual([
      ['2026-10-03T09:00:00.000Z', '2026-10-03T09:20:00.000Z'],
      ['2026-10-03T09:20:00.000Z', '2026-10-03T09:40:00.000Z'],
      ['2026-10-03T09:40:00.000Z', '2026-10-03T10:00:00.000Z'],
    ]);
    expect(session.changedSections).toEqual(new Set(['schedule']));
  });

  test('numbers simultaneous multi-room groups globally', () => {
    const competition = competitionFixture();
    const main = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    const side = competition.schedule.venues[0]?.rooms[0];
    if (!main || !side) throw new Error('Fixture rooms are incomplete.');
    side.activities.push({ ...structuredClone(main), id: 99, childActivities: [] });
    const session = CompetitionSession.fromCompetition(competition);

    const result = session.round('333-r1').createGroupsAcrossActivities({
      blocks: [
        { activityId: main.id, count: 2 },
        { activityId: 99, count: 2 },
      ],
    });
    session.round('333-r1').setScrambleSetCountFromGroups();

    expect(result.groups.map((group) => group.activityCode)).toEqual([
      '333-r1-g1',
      '333-r1-g2',
      '333-r1-g3',
      '333-r1-g4',
    ]);
    expect(result.rooms).toEqual(['Main Stage', 'Side Stage']);
    expect(session.export().events[0]?.rounds[0]?.scrambleSetCount).toBe(2);
  });

  test('does not mutate the schedule when planning fails', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const before = session.export().schedule;
    expect(() => session.round('333-r1').createGroups({ count: 0 })).toThrow(
      'positive integer',
    );
    expect(session.export().schedule).toEqual(before);
    expect(session.changedSections.size).toBe(0);
  });

  test('rejects group counts that would create zero-duration activities', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const before = session.export().schedule;
    expect(() =>
      session.round('333-r1').createGroups({
        count: 2,
        startTime: '2026-10-03T09:00:00.000Z',
        endTime: '2026-10-03T09:00:00.001Z',
      }),
    ).toThrow('at least one millisecond');
    expect(session.export().schedule).toEqual(before);
  });

  test('schedules an unscheduled round in an explicitly named room', () => {
    const competition = competitionFixture();
    const room = competition.schedule.venues[1]?.rooms[0];
    if (!room) throw new Error('Fixture has no main room.');
    room.activities = room.activities.filter(
      (candidate) => candidate.activityCode !== '333-r2',
    );
    const session = CompetitionSession.fromCompetition(competition);

    const result = session.round('333-r2').createGroups({
      count: 2,
      room: 'Main Stage',
      startTime: '2026-10-03T11:00:00.000Z',
      endTime: '2026-10-03T11:30:00.000Z',
    });

    expect(result.groups).toHaveLength(2);
    expect(
      activities(session.export()).some(
        ({ activity: candidate }) => candidate.activityCode === '333-r2',
      ),
    ).toBe(true);
  });

  test('requires a room when a round is ambiguous and validates room names', () => {
    const competition = competitionFixture();
    const sideRoom = competition.schedule.venues[0]?.rooms[0];
    const scheduled = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    if (!sideRoom || !scheduled) throw new Error('Fixture rooms are incomplete.');
    sideRoom.activities.push({ ...structuredClone(scheduled), id: 99 });

    expect(() =>
      CompetitionSession.fromCompetition(competition)
        .round('333-r1')
        .createGroups({ count: 2 }),
    ).toThrow('multiple rooms');
    expect(() =>
      CompetitionSession.fromCompetition(competitionFixture())
        .round('333-r2')
        .createGroups({
          count: 2,
          room: 'Missing Room',
          startTime: '2026-10-03T11:00:00.000Z',
          endTime: '2026-10-03T11:30:00.000Z',
        }),
    ).toThrow('does not exist');
  });

  test('can refuse to replace existing child activities', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    expect(() => round.createGroups({ count: 3, replace: false })).toThrow(
      'already has child activities',
    );
    expect(groupsForRound(session.export(), '333-r1')).toHaveLength(2);
  });

  test('replaces existing groups without leaking orphan activities', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    session.round('333-r1').createGroups({ count: 2 });
    await session.round('333-r1').assignCompetitors();
    const oldSecondGroupId = groupsForRound(session.export(), '333-r1')[1]?.id;
    session.round('333-r1').createGroups({ count: 1 });
    const assignments = session
      .export()
      .persons.flatMap((person) => person.assignments ?? []);
    expect(
      assignments.some((assignment) => assignment.activityId === oldSecondGroupId),
    ).toBe(false);
    expect(session.changedSections).toEqual(new Set(['schedule', 'persons']));
    session.round('333-r1').createGroups({ count: 4 });
    expect(groupsForRound(session.export(), '333-r1')).toHaveLength(4);
  });

  test('does not expose mutable activities in its result', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const result = session.round('333-r1').createGroups({ count: 2 });
    const first = result.groups[0];
    if (!first) throw new Error('No group was created.');
    first.name = 'External mutation';
    expect(groupsForRound(session.export(), '333-r1')[0]?.name).not.toBe(
      'External mutation',
    );
  });

  test('excludes attempt activities from round groups', () => {
    const competition = competitionFixture();
    const parent = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    if (!parent) throw new Error('Fixture is missing the round activity.');
    const group = activity(
      3,
      '333-r1-g1',
      '2026-10-03T09:00:00.000Z',
      '2026-10-03T09:30:00.000Z',
    );
    group.childActivities.push(
      activity(4, '333-r1-g1-a1', '2026-10-03T09:00:00.000Z', '2026-10-03T09:10:00.000Z'),
    );
    parent.childActivities.push(group);
    expect(groupsForRound(competition, '333-r1')).toEqual([group]);
  });

  test('keeps assignment identities distinct for people without registrations', () => {
    const competition = competitionFixture();
    const parent = competition.schedule.venues[1]?.rooms[0]?.activities[0];
    const template = competition.persons[0];
    if (!parent || !template) throw new Error('Fixture is incomplete.');
    const firstGroup = activity(
      3,
      '333-r1-g1',
      '2026-10-03T09:00:00.000Z',
      '2026-10-03T09:30:00.000Z',
    );
    const secondGroup = activity(
      4,
      '333-r1-g2',
      '2026-10-03T09:30:00.000Z',
      '2026-10-03T10:00:00.000Z',
    );
    parent.childActivities = [firstGroup, secondGroup];
    competition.persons.push(
      {
        ...structuredClone(template),
        registrantId: null,
        wcaUserId: 101,
        name: 'First organizer',
        registration: null,
        assignments: [
          {
            activityId: secondGroup.id,
            assignmentCode: 'staff-runner',
            stationNumber: null,
          },
        ],
      },
      {
        ...structuredClone(template),
        registrantId: null,
        wcaUserId: 102,
        name: 'Second organizer',
        registration: null,
        assignments: [
          {
            activityId: firstGroup.id,
            assignmentCode: 'staff-runner',
            stationNumber: null,
          },
        ],
      },
    );

    const session = CompetitionSession.fromCompetition(competition);
    session.round('333-r1').createGroups({ count: 1 });
    const [firstOrganizer, secondOrganizer] = session.export().persons.slice(-2);
    expect(firstOrganizer?.assignments).toEqual([]);
    expect(secondOrganizer?.assignments).toEqual([
      {
        activityId: firstGroup.id,
        assignmentCode: 'staff-runner',
        stationNumber: null,
      },
    ]);
  });
});
