import { groupNumber, parseRoundId, roundIdFor } from '../domain/activity-code';
import { groupsForRound, roundEntrants } from '../domain/competition';
import type {
  Activity,
  Competition,
  GroupConstraint,
  GroupPreference,
  SchedulablePerson,
} from '../domain/types';
import { PlanningError } from '../errors';
import {
  balancedMatchingStrategy,
  type GroupAssignmentStrategy,
} from '../solver/group-strategy';
import { assignCompetitors } from './competitors';
import { createGroups } from './groups';

const DEFAULT_IMPROVEMENT_PASSES = 4;

export interface AssignParallelRoundsOptions {
  readonly roundIds: readonly string[];
  readonly groupCount: number;
  readonly maxWaveSize?: number;
  readonly constraints?: readonly GroupConstraint[];
  readonly preferences?: readonly GroupPreference[];
  readonly stationOrder?: (person: SchedulablePerson, eventId: string) => number;
  readonly seed?: string | number;
  readonly improvementPasses?: number;
}

export interface ParallelAssignmentSummary {
  readonly people: number;
  readonly waves: number;
  readonly assignments: number;
}

export interface ParallelPlanResult {
  readonly summary: ParallelAssignmentSummary;
  readonly schedule: Competition['schedule'];
}

function validateRounds(roundIds: readonly string[]): void {
  if (roundIds.length < 2) {
    throw new PlanningError('Parallel planning requires at least two distinct rounds.');
  }
  if (new Set(roundIds).size !== roundIds.length) {
    throw new PlanningError('Parallel round ids must be unique.');
  }
  for (const roundId of roundIds) parseRoundId(roundId);
}

function assertAligned(groupSets: readonly (readonly Activity[])[]): void {
  const first = groupSets[0];
  if (!first) throw new PlanningError('Parallel planning has no anchor round.');
  for (const groups of groupSets.slice(1)) {
    const aligned = groups.every(
      (group, index) =>
        group.startTime === first[index]?.startTime &&
        group.endTime === first[index]?.endTime,
    );
    if (groups.length !== first.length || !aligned) {
      throw new PlanningError('Parallel round groups must use aligned time windows.');
    }
  }
}

function uniquePeople(
  entrantsByRound: ReadonlyMap<string, readonly SchedulablePerson[]>,
): SchedulablePerson[] {
  const people = new Map<number, SchedulablePerson>();
  for (const entrants of entrantsByRound.values()) {
    for (const person of entrants) people.set(person.registrantId, person);
  }
  return [...people.values()];
}

function fixedWaveStrategy(
  waveByPerson: ReadonlyMap<number, number>,
): GroupAssignmentStrategy {
  return {
    solve({ people, groups }) {
      return new Map(
        groups.map((group) => [
          group,
          people.filter(
            (person) => waveByPerson.get(person.registrantId) === groupNumber(group),
          ),
        ]),
      );
    },
  };
}

function parallelOverlapRule(roundIds: ReadonlySet<string>) {
  return (
    _person: SchedulablePerson,
    assignment: { readonly assignmentCode: string },
    existing: Activity,
    target: Activity,
  ): boolean => {
    const existingRound = roundIdFor(existing);
    const targetRound = roundIdFor(target);
    return (
      assignment.assignmentCode === 'competitor' &&
      existingRound !== null &&
      targetRound !== null &&
      roundIds.has(existingRound) &&
      roundIds.has(targetRound) &&
      groupNumber(existing) === groupNumber(target) &&
      existing.startTime === target.startTime &&
      existing.endTime === target.endTime
    );
  };
}

export async function planParallelRounds(
  competition: Competition,
  options: AssignParallelRoundsOptions,
): Promise<ParallelPlanResult> {
  validateRounds(options.roundIds);
  const entrantsByRound = new Map(
    options.roundIds.map((roundId) => [roundId, roundEntrants(competition, roundId)]),
  );
  for (const roundId of options.roundIds) {
    createGroups(competition, roundId, { count: options.groupCount });
  }
  const groupSets = options.roundIds.map((roundId) =>
    groupsForRound(competition, roundId),
  );
  assertAligned(groupSets);
  const schedule = structuredClone(competition.schedule);
  const people = uniquePeople(entrantsByRound);
  if (people.length === 0) throw new PlanningError('No parallel-round entrants exist.');
  const groups = groupSets[0];
  if (!groups) throw new PlanningError('Parallel planning has no anchor groups.');
  const allocation = await balancedMatchingStrategy.solve({
    competition,
    people,
    groups,
    constraints: options.constraints ?? [],
    preferences: options.preferences ?? [],
    seed: options.seed ?? options.roundIds.join(':'),
    improvementPasses: options.improvementPasses ?? DEFAULT_IMPROVEMENT_PASSES,
    ...(options.maxWaveSize === undefined ? {} : { maxGroupSize: options.maxWaveSize }),
  });
  const waveByPerson = new Map(
    [...allocation].flatMap(([group, members]) => {
      const wave = groupNumber(group);
      return wave === null
        ? []
        : members.map((person) => [person.registrantId, wave] as const);
    }),
  );
  const strategy = fixedWaveStrategy(waveByPerson);
  const overlapRule = parallelOverlapRule(new Set(options.roundIds));
  const stationOrder = options.stationOrder;
  let assignments = 0;
  for (const roundId of options.roundIds) {
    const entrantIds = new Set(
      (entrantsByRound.get(roundId) ?? []).map((person) => person.registrantId),
    );
    const { eventId } = parseRoundId(roundId);
    const result = await assignCompetitors(competition, roundId, {
      select: (person) =>
        person.registrantId !== null && entrantIds.has(person.registrantId),
      strategy,
      allowOverlap: overlapRule,
      ...(options.maxWaveSize === undefined ? {} : { maxGroupSize: options.maxWaveSize }),
      ...(stationOrder
        ? { stationOrder: (person) => stationOrder(person, eventId) }
        : {}),
    });
    assignments += result.assigned;
  }
  return {
    summary: { people: people.length, waves: options.groupCount, assignments },
    schedule,
  };
}
