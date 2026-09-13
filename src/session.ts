import { type ChangeSummary, summarizeChanges } from './changes';
import {
  assignmentsByPerson,
  assignmentsState,
  cloneCompetition,
  copyAssignments,
  findRound,
  personKey,
  stableJson,
} from './domain/competition';
import type { Competition, CompetitionTransport, WritableSection } from './domain/types';
import { PublishConflictError, TypeCompError } from './errors';
import { ActivityPlan } from './planning/activity';
import {
  type AssignParallelRoundsOptions,
  type ParallelAssignmentSummary,
  planParallelRounds,
} from './planning/parallel';
import { RoundPlan } from './planning/round';
import { assertValidCompetition, validateCompetition } from './validation';

function changedAssignmentKeys(
  baseline: Competition,
  working: Competition,
): ReadonlySet<string> {
  const baselineByKey = assignmentsByPerson(baseline);
  return new Set(
    working.persons
      .filter(
        (person) =>
          assignmentsState(person.assignments) !==
          assignmentsState(baselineByKey.get(personKey(person))),
      )
      .map(personKey),
  );
}

function assignmentsChangedRemotely(
  fresh: Competition,
  baseline: Competition,
  changedKeys: ReadonlySet<string>,
): boolean {
  const freshByKey = assignmentsByPerson(fresh);
  return baseline.persons.some(
    (person) =>
      changedKeys.has(personKey(person)) &&
      (!freshByKey.has(personKey(person)) ||
        assignmentsState(person.assignments) !==
          assignmentsState(freshByKey.get(personKey(person)))),
  );
}

function scrambleSetState(competition: Competition): string {
  return stableJson(
    competition.events
      .flatMap((event) =>
        event.rounds.map((round) => ({
          id: round.id,
          count: round.scrambleSetCount ?? null,
        })),
      )
      .sort((first, second) => first.id.localeCompare(second.id)),
  );
}

function mergeAssignments(
  fresh: Competition,
  working: Competition,
  changedKeys: ReadonlySet<string>,
): Competition['persons'] {
  const assignmentsByKey = assignmentsByPerson(working);
  return fresh.persons.map((person) =>
    changedKeys.has(personKey(person))
      ? {
          ...person,
          assignments: structuredClone(assignmentsByKey.get(personKey(person)) ?? []),
        }
      : person,
  );
}

function changedSections(
  baseline: Competition,
  working: Competition,
): ReadonlySet<WritableSection> {
  const sections = new Set<WritableSection>();
  if (changedAssignmentKeys(baseline, working).size > 0) sections.add('persons');
  if (stableJson(baseline.schedule) !== stableJson(working.schedule)) {
    sections.add('schedule');
  }
  if (scrambleSetState(baseline) !== scrambleSetState(working)) {
    sections.add('events');
  }
  return sections;
}

function mergeScrambleSetCounts(
  fresh: Competition,
  working: Competition,
): Competition['events'] {
  const countByRound = new Map(
    working.events.flatMap((event) =>
      event.rounds.map((round) => [round.id, round.scrambleSetCount] as const),
    ),
  );
  return fresh.events.map((event) => ({
    ...event,
    rounds: event.rounds.map((round) => {
      const count = countByRound.get(round.id);
      const merged = { ...round };
      if (count === undefined) delete merged.scrambleSetCount;
      else merged.scrambleSetCount = count;
      return merged;
    }),
  }));
}

function assertCompetitionId(competition: Competition, expectedId: string): void {
  if (competition.id !== expectedId) {
    throw new TypeCompError(
      `Expected competition ${expectedId}, received ${competition.id}.`,
      'COMPETITION_ID_MISMATCH',
    );
  }
}

export class CompetitionSession {
  private baseline: Competition;
  private working: Competition;

  private constructor(
    competition: Competition,
    private readonly transport?: CompetitionTransport,
  ) {
    this.baseline = cloneCompetition(competition);
    this.working = cloneCompetition(competition);
  }

  static fromCompetition(competition: Competition): CompetitionSession {
    return new CompetitionSession(competition);
  }

  static async load(
    transport: CompetitionTransport,
    competitionId: string,
  ): Promise<CompetitionSession> {
    const competition = await transport.fetchCompetition(competitionId);
    assertCompetitionId(competition, competitionId);
    return new CompetitionSession(competition, transport);
  }

  get competition(): Readonly<Competition> {
    return cloneCompetition(this.working);
  }

  get changedSections(): ReadonlySet<WritableSection> {
    return changedSections(this.baseline, this.working);
  }

  changes(): ChangeSummary {
    return summarizeChanges(this.baseline, this.working, this.changedSections);
  }

  round(roundId: string): RoundPlan {
    return new RoundPlan(() => this.working, roundId);
  }

  activity(activityId: number): ActivityPlan {
    return new ActivityPlan(() => this.working, activityId);
  }

  async atomic<T>(operation: (draft: CompetitionSession) => T | Promise<T>): Promise<T> {
    const draft = new CompetitionSession(this.working);
    const result = await operation(draft);
    this.working = cloneCompetition(draft.working);
    return result;
  }

  async assignParallelRounds(
    options: AssignParallelRoundsOptions,
  ): Promise<ParallelAssignmentSummary> {
    const draft = cloneCompetition(this.working);
    const result = await planParallelRounds(draft, options);
    copyAssignments(this.working, draft);
    this.working.schedule = result.schedule;
    for (const roundId of options.roundIds) {
      findRound(this.working, roundId).scrambleSetCount = options.groupCount;
    }
    return result.summary;
  }

  validate() {
    return validateCompetition(this.working);
  }

  export(): Competition {
    return cloneCompetition(this.working);
  }

  async refresh(): Promise<void> {
    if (!this.transport)
      throw new TypeCompError('This session has no WCA transport.', 'NO_TRANSPORT');
    if (this.changedSections.size > 0) {
      throw new TypeCompError(
        'Cannot refresh a session with unpublished changes.',
        'DIRTY_SESSION',
      );
    }
    const fresh = await this.transport.fetchCompetition(this.working.id);
    assertCompetitionId(fresh, this.working.id);
    this.baseline = cloneCompetition(fresh);
    this.working = cloneCompetition(fresh);
  }

  async publish(): Promise<Competition> {
    if (!this.transport)
      throw new TypeCompError('This session has no WCA transport.', 'NO_TRANSPORT');
    const sections = this.changedSections;
    if (sections.size === 0) return this.export();
    assertValidCompetition(this.working);

    const fresh = await this.transport.fetchCompetition(this.working.id);
    assertCompetitionId(fresh, this.working.id);
    const patch: Partial<Pick<Competition, WritableSection>> = {};

    if (sections.has('persons')) {
      const changedKeys = changedAssignmentKeys(this.baseline, this.working);
      if (assignmentsChangedRemotely(fresh, this.baseline, changedKeys)) {
        throw new PublishConflictError('assignments');
      }
      patch.persons = mergeAssignments(fresh, this.working, changedKeys);
    }
    if (sections.has('schedule')) {
      if (stableJson(fresh.schedule) !== stableJson(this.baseline.schedule)) {
        throw new PublishConflictError('schedule');
      }
      patch.schedule = cloneCompetition(this.working).schedule;
    }
    if (sections.has('events')) {
      if (scrambleSetState(fresh) !== scrambleSetState(this.baseline)) {
        throw new PublishConflictError('scramble set counts');
      }
      patch.events = mergeScrambleSetCounts(fresh, this.working);
    }

    assertValidCompetition({ ...fresh, ...patch });
    const published = await this.transport.publishCompetition(this.working.id, patch);
    assertCompetitionId(published, this.working.id);
    this.baseline = cloneCompetition(published);
    this.working = cloneCompetition(published);
    return this.export();
  }
}
