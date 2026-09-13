import {
  activities,
  assignmentsForActivity,
  type Competition,
  type CompetitionSession,
  findActivity,
  findRound,
  type GroupAssignmentStrategy,
  groupsForRound,
  type Person,
  parseActivityCode,
  parseRoundId,
  roundIdFor,
  type SchedulablePerson,
  schedulablePeople,
} from '@speedcubingireland/typecomp';
import { groupifierOrder, groupifierStrategy, stationOrder } from './competitors';
import type { GroupifierOptions } from './config';
import {
  type ResolvedActivityOptions,
  type ResolvedRoundOptions,
  resolveOptions,
  validateOptions,
} from './configuration';
import { type GroupifierStaffRole, selectStaff } from './staff';

const DISTRIBUTED_EVENTS = new Set(['333fm', '333mbf']);

function attemptNumberForRound(
  activity: { readonly activityCode: string },
  roundId: string,
) {
  const parsed = parseActivityCode(activity.activityCode);
  return roundIdFor(activity) === roundId && parsed?.attemptNumber !== null
    ? (parsed?.attemptNumber ?? null)
    : null;
}

export interface GroupifierPlanSummary {
  readonly rounds: number;
  readonly competitors: number;
  readonly staff: number;
}

function assignmentActivityIds(
  competition: Competition,
  roundId: string,
): ReadonlySet<number> {
  const { eventId } = parseRoundId(roundId);
  if (!DISTRIBUTED_EVENTS.has(eventId)) {
    return new Set(groupsForRound(competition, roundId).map((group) => group.id));
  }
  return new Set(
    activities(competition)
      .map(({ activity }) => activity)
      .filter((activity) => attemptNumberForRound(activity, roundId) !== null)
      .map((activity) => activity.id),
  );
}

function roundCanBeAssigned(competition: Competition, roundId: string): boolean {
  const { roundNumber } = parseRoundId(roundId);
  const round = findRound(competition, roundId);
  const resultsAreEmpty =
    round.results.length === 0
      ? roundNumber === 1
      : round.results.every((result) => result.attempts.length === 0);
  if (!resultsAreEmpty) return false;
  const groupIds = assignmentActivityIds(competition, roundId);
  if (groupIds.size === 0) return false;
  return !competition.persons.some((person) =>
    (person.assignments ?? []).some((assignment) => groupIds.has(assignment.activityId)),
  );
}

function distributedRounds(competition: Competition): string[] {
  return competition.events
    .filter((event) => DISTRIBUTED_EVENTS.has(event.id))
    .flatMap((event) => event.rounds.map((round) => round.id))
    .filter((roundId) => roundCanBeAssigned(competition, roundId));
}

function entrants(competition: Competition, roundId: string): SchedulablePerson[] {
  const { eventId, roundNumber } = parseRoundId(roundId);
  const round = findRound(competition, roundId);
  const people = schedulablePeople(competition);
  if (round.results.length > 0) {
    const ids = new Set(round.results.map((result) => result.personId));
    return people.filter((person) => ids.has(person.registrantId));
  }
  if (roundNumber > 1) {
    throw new RangeError(`${roundId} has no known entrants.`);
  }
  return people.filter(
    (person) =>
      person.registration?.status === 'accepted' &&
      person.registration.isCompeting &&
      person.registration.eventIds.some((registered) => registered === eventId),
  );
}

function createMissingGroups(
  session: CompetitionSession,
  rounds: readonly ResolvedRoundOptions[],
): void {
  for (const round of rounds) {
    const plan = session.round(round.roundId);
    if (plan.groups().length === 0) {
      plan.createGroupsAcrossActivities({
        blocks: round.activities.map((activity) => ({
          activityId: activity.activityId,
          count: activity.groups,
        })),
        replace: false,
      });
    }
    plan.setScrambleSetCountFromGroups();
  }
}

async function assignCompetitors(
  session: CompetitionSession,
  rounds: readonly ResolvedRoundOptions[],
  options: GroupifierOptions,
): Promise<number> {
  const ordered = [...rounds].sort(
    (first, second) =>
      groupsForRound(session.competition, first.roundId).length -
      groupsForRound(session.competition, second.roundId).length,
  );
  let assigned = 0;
  for (const round of ordered) {
    const competition = session.competition;
    const people = entrants(competition, round.roundId);
    const entrantIds = new Set(people.map((person) => person.registrantId));
    const capacityByActivityId = new Map(
      round.activities.map((activity) => [activity.activityId, activity.capacity]),
    );
    const result = await session.round(round.roundId).assignCompetitors({
      select: (person) =>
        person.registrantId !== null && entrantIds.has(person.registrantId),
      strategy: groupifierStrategy(
        round.roundId,
        options.assignments.competitorSortingRule,
        capacityByActivityId,
      ),
      allowOverlap: () => true,
      ...(options.assignments.printStations
        ? { stationOrder: stationOrder(competition, round.roundId, people) }
        : {}),
    });
    assigned += result.assigned;
  }
  return assigned;
}

function chunkStrategy(
  roundId: string,
  groupCount: number,
  sortingRule: GroupifierOptions['assignments']['competitorSortingRule'],
): GroupAssignmentStrategy {
  return {
    solve(problem) {
      const people = groupifierOrder(
        problem.competition,
        roundId,
        problem.people,
        sortingRule,
        groupCount,
      );
      const size = Math.ceil(people.length / problem.groups.length);
      return new Map(
        problem.groups.map((activity, index) => [
          activity,
          people.slice(index * size, (index + 1) * size),
        ]),
      );
    },
  };
}

async function assignDistributedCompetitors(
  session: CompetitionSession,
  roundIds: readonly string[],
  options: GroupifierOptions,
): Promise<number> {
  let assigned = 0;
  for (const roundId of roundIds) {
    const competition = session.competition;
    const people = entrants(competition, roundId);
    const entrantIds = new Set(people.map((person) => person.registrantId));
    const attemptActivities = activities(competition)
      .map(({ activity }) => activity)
      .filter((activity) => attemptNumberForRound(activity, roundId) !== null);
    const totalActivities = attemptActivities.length;
    const attempts = new Map<number, number[]>();
    for (const activity of attemptActivities) {
      const attempt = attemptNumberForRound(activity, roundId);
      if (attempt !== null)
        attempts.set(attempt, [...(attempts.get(attempt) ?? []), activity.id]);
    }
    for (const activityIds of [...attempts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, ids]) => ids)) {
      const result = await session.round(roundId).assignCompetitors({
        activityIds,
        select: (person) =>
          person.registrantId !== null && entrantIds.has(person.registrantId),
        strategy: chunkStrategy(
          roundId,
          totalActivities,
          options.assignments.competitorSortingRule,
        ),
        allowOverlap: () => true,
      });
      assigned += result.assigned;
    }
    session.round(roundId).setScrambleSetCount(1);
  }
  return assigned;
}

function activityOptions(
  competition: Competition,
  round: ResolvedRoundOptions,
  groupId: number,
): ResolvedActivityOptions {
  const parent = findActivity(competition, groupId)?.parent;
  const options = round.activities.find((activity) => activity.activityId === parent?.id);
  if (!options) throw new Error(`Group ${groupId} has no activity configuration.`);
  return options;
}

function configuredCount(
  competition: Competition,
  round: ResolvedRoundOptions,
  groupId: number,
  role: GroupifierStaffRole,
): number | null {
  const options = activityOptions(competition, round, groupId);
  if (role === 'staff-scrambler') return options.scramblers;
  if (role === 'staff-runner') return options.runners;
  if (!options.assignJudges) return null;
  const competitors = assignmentsForActivity(competition, groupId).filter(
    ({ assignment }) => assignment.assignmentCode === 'competitor',
  ).length;
  return Math.min(options.stations, competitors);
}

function assignStaffRole(
  session: CompetitionSession,
  round: ResolvedRoundOptions,
  role: GroupifierStaffRole,
  options: GroupifierOptions,
): number {
  const { eventId } = parseRoundId(round.roundId);
  const competitorIds = new Set(
    entrants(session.competition, round.roundId).map((person) => person.registrantId),
  );
  let assigned = 0;
  const groups = round.activities.flatMap((configured) => {
    const parent = findActivity(session.competition, configured.activityId)?.activity;
    if (!parent) throw new Error(`Activity ${configured.activityId} does not exist.`);
    return parent.childActivities ?? [];
  });
  for (const group of groups) {
    const count = configuredCount(session.competition, round, group.id, role);
    if (count === null) continue;
    const selected = selectStaff(
      session.competition,
      group,
      eventId,
      role,
      count,
      options.assignments,
      competitorIds,
    );
    const selectedIds = new Set(selected.map((person) => person.wcaUserId));
    const result = session.activity(group.id).assignStaff({
      roles: [{ assignmentCode: role, count: selected.length }],
      select: (person: Person) => selectedIds.has(person.wcaUserId),
      loadPenalty: 0,
      replaceExisting: 'same-roles',
      seed: `${round.roundId}:${group.id}:${role}`,
    });
    assigned += result.assigned;
  }
  return assigned;
}

function assignStaff(
  session: CompetitionSession,
  rounds: readonly ResolvedRoundOptions[],
  entrantCount: ReadonlyMap<string, number>,
  options: GroupifierOptions,
): number {
  let assigned = 0;
  const scramblingOrder = [...rounds].sort(
    (first, second) =>
      (entrantCount.get(first.roundId) ?? 0) - (entrantCount.get(second.roundId) ?? 0),
  );
  for (const round of scramblingOrder) {
    assigned += assignStaffRole(session, round, 'staff-scrambler', options);
  }
  for (const role of ['staff-runner', 'staff-judge'] as const) {
    for (const round of rounds)
      assigned += assignStaffRole(session, round, role, options);
  }
  return assigned;
}

export async function planLikeGroupifier(
  session: CompetitionSession,
  options: GroupifierOptions,
): Promise<GroupifierPlanSummary> {
  validateOptions(options);
  return session.atomic(async (draft) => {
    const configured = resolveOptions(draft.competition, options);
    createMissingGroups(draft, configured);
    const distributed = distributedRounds(draft.competition);
    const rounds = configured.filter((round) =>
      roundCanBeAssigned(draft.competition, round.roundId),
    );
    const entrantCount = new Map(
      rounds.map((round) => [
        round.roundId,
        entrants(draft.competition, round.roundId).length,
      ]),
    );
    const competitors =
      (await assignDistributedCompetitors(draft, distributed, options)) +
      (await assignCompetitors(draft, rounds, options));
    const staff = assignStaff(draft, rounds, entrantCount, options);
    return { rounds: rounds.length + distributed.length, competitors, staff };
  });
}
