import { describe, expect, test } from 'bun:test';
import type { Competition, CompetitionTransport, WritableSection } from '../src/index';
import { CompetitionSession, groupsForRound, PublishConflictError } from '../src/index';
import { competitionFixture } from './fixture';

class MemoryTransport implements CompetitionTransport {
  remote: Competition;
  published: Partial<Pick<Competition, WritableSection>> | undefined;

  constructor(competition: Competition) {
    this.remote = structuredClone(competition);
  }

  async fetchCompetition(): Promise<Competition> {
    return structuredClone(this.remote);
  }

  async publishCompetition(
    _competitionId: string,
    patch: Partial<Pick<Competition, WritableSection>>,
  ): Promise<Competition> {
    this.published = structuredClone(patch);
    this.remote = { ...this.remote, ...structuredClone(patch) };
    return structuredClone(this.remote);
  }
}

describe('live-safe sessions', () => {
  test('commits multi-step plans atomically', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());

    await session.atomic(async (draft) => {
      draft.round('333-r1').createGroups({ count: 2 });
      await draft.round('333-r1').assignCompetitors();
    });

    expect(groupsForRound(session.export(), '333-r1')).toHaveLength(2);
    expect(
      session
        .export()
        .persons.every((person) =>
          person.assignments?.some(
            (assignment) => assignment.assignmentCode === 'competitor',
          ),
        ),
    ).toBe(true);
  });

  test('discards every step when an atomic plan fails', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const before = session.export();

    await expect(
      session.atomic(async (draft) => {
        draft.round('333-r1').createGroups({ count: 2 });
        await draft.round('333-r1').assignCompetitors();
        throw new Error('Stop the plan.');
      }),
    ).rejects.toThrow('Stop the plan');
    expect(session.export()).toEqual(before);
  });

  test('summarizes pending changes without exposing mutable state', async () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    expect(session.changes()).toEqual({
      sections: new Set(),
      activities: { added: 0, removed: 0, updated: 0 },
      assignments: { added: 0, removed: 0 },
      scrambleSetCounts: 0,
    });

    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    await round.assignCompetitors();
    round.setScrambleSetCount(2);

    expect(session.changes()).toEqual({
      sections: new Set(['schedule', 'persons', 'events']),
      activities: { added: 2, removed: 0, updated: 0 },
      assignments: { added: 8, removed: 0 },
      scrambleSetCounts: 1,
    });
  });

  test('does not expose mutable session state', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    const snapshot = session.competition;
    const first = snapshot.persons[0];
    if (!first) throw new Error('Fixture has no people.');
    first.name = 'Accidental mutation';
    expect(session.export().persons[0]?.name).not.toBe('Accidental mutation');
  });

  test('preserves newly synchronized results when publishing round metadata', async () => {
    const transport = new MemoryTransport(competitionFixture());
    const session = await CompetitionSession.load(transport, 'TestOpen2026');
    session.round('333-r1').setScrambleSetCount(2);

    const remoteRound = transport.remote.events[0]?.rounds[0];
    if (!remoteRound) throw new Error('Fixture is missing round one.');
    remoteRound.results.push({
      personId: 1,
      ranking: 1,
      attempts: [],
      best: 1_100,
      average: 1_200,
    });

    const published = await session.publish();
    expect(transport.published?.events?.[0]?.rounds[0]?.results).toHaveLength(1);
    expect(published.events[0]?.rounds[0]?.scrambleSetCount).toBe(2);
    expect(published.events[0]?.rounds[0]?.results).toHaveLength(1);
    expect(session.changedSections.size).toBe(0);
  });

  test('rejects publishing over remotely changed assignments', async () => {
    const transport = new MemoryTransport(competitionFixture());
    const session = await CompetitionSession.load(transport, 'TestOpen2026');
    const round = session.round('333-r1');
    round.createGroups({ count: 2 });
    await round.assignCompetitors();

    transport.remote.persons[0]?.assignments?.push({
      activityId: 1,
      assignmentCode: 'competitor',
      stationNumber: null,
    });

    await expect(session.publish()).rejects.toBeInstanceOf(PublishConflictError);
    expect(transport.published).toBeUndefined();
  });

  test('preserves concurrent assignment changes to untouched people', async () => {
    const transport = new MemoryTransport(competitionFixture());
    const session = await CompetitionSession.load(transport, 'TestOpen2026');
    session.activity(1).assignStaff({
      select: (person) => person.registrantId === 1,
      roles: [{ assignmentCode: 'staff-announcer', count: 1 }],
    });
    transport.remote.persons[1]?.assignments?.push({
      activityId: 2,
      assignmentCode: 'staff-runner',
      stationNumber: null,
    });

    const published = await session.publish();
    expect(published.persons[1]?.assignments).toContainEqual({
      activityId: 2,
      assignmentCode: 'staff-runner',
      stationNumber: null,
    });
  });

  test('will not discard unpublished work during refresh', async () => {
    const transport = new MemoryTransport(competitionFixture());
    const session = await CompetitionSession.load(transport, 'TestOpen2026');
    session.round('333-r1').setScrambleSetCount(2);
    await expect(session.refresh()).rejects.toMatchObject({ code: 'DIRTY_SESSION' });
  });

  test('keeps existing plans connected after publishing', async () => {
    const transport = new MemoryTransport(competitionFixture());
    const session = await CompetitionSession.load(transport, 'TestOpen2026');
    const round = session.round('333-r1');
    round.setScrambleSetCount(2);
    await session.publish();

    round.setScrambleSetCount(3);
    expect(session.changedSections).toEqual(new Set(['events']));
    expect(session.export().events[0]?.rounds[0]?.scrambleSetCount).toBe(3);
  });

  test('derives change state instead of recording no-op mutations', () => {
    const session = CompetitionSession.fromCompetition(competitionFixture());
    session.round('333-r1').setScrambleSetCount(1);
    expect(session.changedSections.size).toBe(0);
  });

  test('treats assignment ordering as non-semantic', () => {
    const competition = competitionFixture();
    competition.persons[0]?.assignments?.push(
      {
        activityId: 1,
        assignmentCode: 'staff-announcer',
        stationNumber: null,
      },
      {
        activityId: 2,
        assignmentCode: 'staff-runner',
        stationNumber: null,
      },
    );
    const session = CompetitionSession.fromCompetition(competition);
    session.activity(1).assignStaff({
      roles: [{ assignmentCode: 'staff-announcer', count: 1 }],
      select: (person) => person.registrantId === 1,
    });
    expect(session.changedSections.size).toBe(0);
  });

  test('rejects a transport response for the wrong competition', async () => {
    const transport = new MemoryTransport(competitionFixture());
    await expect(
      CompetitionSession.load(transport, 'OtherOpen2026'),
    ).rejects.toMatchObject({ code: 'COMPETITION_ID_MISMATCH' });
  });
});
