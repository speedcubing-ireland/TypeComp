import { roundIdFor } from '../domain/activity-code';
import {
  activities,
  assignmentsOf,
  groupsForRound,
  roundEntrants,
  schedulablePeople,
} from '../domain/competition';
import { overlaps } from '../domain/time';
import type {
  Activity,
  Assignment,
  AssignmentSummary,
  Competition,
  GroupConstraint,
  GroupPredicate,
  GroupPreference,
  PersonPredicate,
  SchedulablePerson,
} from '../domain/types';
import { PlanningError } from '../errors';
import {
  balancedMatchingStrategy,
  type GroupAllocation,
  type GroupAssignmentStrategy,
} from '../solver/group-strategy';

const DEFAULT_IMPROVEMENT_PASSES = 4;

interface AssignCompetitorsBaseOptions {
  readonly select?: PersonPredicate;
  readonly maxGroupSize?: number;
  readonly constraints?: readonly GroupConstraint[];
  readonly preferences?: readonly GroupPreference[];
  readonly stationOrder?: (person: SchedulablePerson) => number;
  readonly stationDirection?: 'ascending' | 'descending';
  readonly seed?: string | number;
  readonly strategy?: GroupAssignmentStrategy;
  readonly improvementPasses?: number;
  readonly allowOverlap?: (
    person: SchedulablePerson,
    assignment: Assignment,
    existing: Activity,
    target: Activity,
  ) => boolean;
}

type CompetitorActivitySelection =
  | { readonly groups?: GroupPredicate; readonly activityIds?: never }
  | { readonly activityIds: readonly number[]; readonly groups?: never };

export type AssignCompetitorsOptions = AssignCompetitorsBaseOptions &
  CompetitorActivitySelection;

function validateOptions(options: AssignCompetitorsOptions): void {
  if (options.activityIds && options.groups) {
    throw new PlanningError('Choose activity ids or a group filter, not both.');
  }
  if (
    options.activityIds &&
    new Set(options.activityIds).size !== options.activityIds.length
  ) {
    throw new PlanningError('Competitor activity ids must be unique.');
  }
  if (
    options.maxGroupSize !== undefined &&
    (!Number.isSafeInteger(options.maxGroupSize) || options.maxGroupSize < 1)
  ) {
    throw new PlanningError('The maximum group size must be a positive integer.');
  }
  if (
    options.improvementPasses !== undefined &&
    (!Number.isSafeInteger(options.improvementPasses) || options.improvementPasses < 0)
  ) {
    throw new PlanningError('Improvement passes must be a non-negative integer.');
  }
  if (options.preferences?.some((preference) => !Number.isFinite(preference.weight))) {
    throw new PlanningError('Preference weights must be finite numbers.');
  }
}

function candidatesFor(
  competition: Competition,
  roundId: string,
  select: PersonPredicate | undefined,
): SchedulablePerson[] {
  return select
    ? schedulablePeople(competition).filter(select)
    : roundEntrants(competition, roundId);
}

function conflictConstraint(
  competition: Competition,
  targetIds: ReadonlySet<number>,
  allowOverlap: AssignCompetitorsOptions['allowOverlap'],
): GroupConstraint {
  const allActivities = activities(competition).map(({ activity }) => activity);
  const activityById = new Map(allActivities.map((activity) => [activity.id, activity]));
  const conflictsByGroup = new Map(
    allActivities
      .filter((activity) => targetIds.has(activity.id))
      .map((group) => [
        group.id,
        new Set(
          allActivities
            .filter((activity) => overlaps(group, activity))
            .map((activity) => activity.id),
        ),
      ]),
  );
  return {
    name: 'no overlapping competitor assignments',
    allows(person, group) {
      const conflicts = conflictsByGroup.get(group.id) ?? new Set<number>();
      return !assignmentsOf(person).some((assignment) => {
        if (!conflicts.has(assignment.activityId)) return false;
        if (targetIds.has(assignment.activityId)) {
          return false;
        }
        const existing = activityById.get(assignment.activityId);
        return !(existing && allowOverlap?.(person, assignment, existing, group));
      });
    },
  };
}

function stationsFor(
  members: readonly SchedulablePerson[],
  order: (person: SchedulablePerson) => number,
  direction: 'ascending' | 'descending',
): ReadonlyMap<number, number> {
  const multiplier = direction === 'ascending' ? 1 : -1;
  const ranked = members.map((person) => ({ person, score: order(person) }));
  if (ranked.some(({ score }) => Number.isNaN(score))) {
    throw new PlanningError('The station order returned NaN.');
  }
  ranked.sort((first, second) => {
    const difference =
      first.score < second.score ? -1 : first.score > second.score ? 1 : 0;
    return (
      difference * multiplier || first.person.registrantId - second.person.registrantId
    );
  });
  return new Map(ranked.map(({ person }, index) => [person.registrantId, index + 1]));
}

function applyAllocation(
  competition: Competition,
  allocation: GroupAllocation,
  targetIds: ReadonlySet<number>,
  options: AssignCompetitorsOptions,
): void {
  const additions = new Map<number, Assignment>();
  for (const [group, members] of allocation) {
    const stations = options.stationOrder
      ? stationsFor(
          members,
          options.stationOrder,
          options.stationDirection ?? 'ascending',
        )
      : new Map<number, number>();
    for (const person of members) {
      additions.set(person.registrantId, {
        activityId: group.id,
        assignmentCode: 'competitor',
        stationNumber: stations.get(person.registrantId) ?? null,
      });
    }
  }

  for (const person of schedulablePeople(competition)) {
    const retained = assignmentsOf(person).filter(
      (assignment) =>
        assignment.assignmentCode !== 'competitor' ||
        !targetIds.has(assignment.activityId),
    );
    const addition = additions.get(person.registrantId);
    person.assignments = addition ? [...retained, addition] : retained;
  }
}

function assertCompleteAllocation(
  allocation: GroupAllocation,
  expectedPeople: readonly SchedulablePerson[],
  groups: readonly Activity[],
  constraints: readonly GroupConstraint[],
  competition: Competition,
  maxGroupSize: number | undefined,
): void {
  const assigned = [...allocation.values()].flat();
  const expectedIds = new Set(expectedPeople.map((person) => person.registrantId));
  const assignedIds = assigned.map((person) => person.registrantId);
  const validPeople = assignedIds.every((id) => expectedIds.has(id));
  if (
    !validPeople ||
    assigned.length !== expectedPeople.length ||
    new Set(assignedIds).size !== assigned.length
  ) {
    throw new PlanningError('The assignment strategy returned an incomplete allocation.');
  }
  const validGroups = new Set(groups);
  for (const [group, members] of allocation) {
    if (!validGroups.has(group)) {
      throw new PlanningError('The assignment strategy returned an unknown group.');
    }
    if (maxGroupSize !== undefined && members.length > maxGroupSize) {
      throw new PlanningError('The assignment strategy exceeded the maximum group size.');
    }
    for (const person of members) {
      if (!constraints.every((rule) => rule.allows(person, group, competition))) {
        throw new PlanningError('The assignment strategy violated a hard constraint.');
      }
    }
  }
}

export async function assignCompetitors(
  competition: Competition,
  roundId: string,
  options: AssignCompetitorsOptions = {},
): Promise<AssignmentSummary> {
  validateOptions(options);
  const requestedIds = options.activityIds ? new Set(options.activityIds) : null;
  const groups = requestedIds
    ? activities(competition)
        .map(({ activity }) => activity)
        .filter(
          (activity) => requestedIds.has(activity.id) && roundIdFor(activity) === roundId,
        )
    : groupsForRound(competition, roundId).filter(options.groups ?? (() => true));
  if (requestedIds && groups.length !== requestedIds.size) {
    throw new PlanningError(`Every competitor activity must belong to ${roundId}.`);
  }
  if (groups.length === 0)
    throw new PlanningError(`No competitor activities are available for ${roundId}.`);
  const people = candidatesFor(competition, roundId, options.select);
  if (people.length === 0) {
    throw new PlanningError(`No competitors were selected for ${roundId}.`);
  }
  const targetIds = new Set(groups.map((group) => group.id));
  const constraints = [
    conflictConstraint(competition, targetIds, options.allowOverlap),
    ...(options.constraints ?? []),
  ];
  const allocation = await (options.strategy ?? balancedMatchingStrategy).solve({
    competition,
    people,
    groups,
    constraints,
    preferences: options.preferences ?? [],
    seed: options.seed ?? roundId,
    improvementPasses: options.improvementPasses ?? DEFAULT_IMPROVEMENT_PASSES,
    ...(options.maxGroupSize === undefined ? {} : { maxGroupSize: options.maxGroupSize }),
  });
  assertCompleteAllocation(
    allocation,
    people,
    groups,
    constraints,
    competition,
    options.maxGroupSize,
  );
  applyAllocation(competition, allocation, targetIds, options);
  return { assigned: people.length, activities: groups.length };
}
