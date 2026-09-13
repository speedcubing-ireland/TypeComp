import {
  activities,
  assignmentsOf,
  findActivity,
  groupsForRound,
  personKey,
} from '../domain/competition';
import { shuffled } from '../domain/random';
import { overlaps } from '../domain/time';
import type {
  Activity,
  Assignment,
  AssignmentSummary,
  Competition,
  GroupPredicate,
  Person,
  PersonPredicate,
  StaffConstraint,
  StaffRole,
  StaffScorer,
} from '../domain/types';
import { PlanningError } from '../errors';
import { accepted } from '../filters';
import { type MatchingConstraint, solveMatching } from '../solver/matching';

const DEFAULT_LOAD_PENALTY = 1_000_000;

export interface AssignStaffOptions {
  readonly roles: readonly StaffRole[];
  readonly select?: PersonPredicate;
  readonly groups?: GroupPredicate;
  readonly constraints?: readonly StaffConstraint[];
  readonly preferences?: readonly StaffScorer[];
  readonly loadPenalty?: number;
  readonly seed?: string | number;
  readonly replaceExisting?: 'all-staff' | 'same-roles';
}

type ReplacedAssignment = (assignment: Assignment) => boolean;

interface StaffSlot {
  readonly assignmentCode: `staff-${string}`;
  readonly stationNumber: number | null;
  readonly eligible?: PersonPredicate;
}

interface PlannedStaff {
  readonly person: Person;
  readonly assignment: Assignment;
}

interface StaffPlanningContext {
  readonly competition: Competition;
  readonly candidates: readonly Person[];
  readonly slots: readonly StaffSlot[];
  readonly options: AssignStaffOptions;
  readonly replaced: ReplacedAssignment;
  readonly counts: Map<string, number>;
  readonly activityById: ReadonlyMap<number, Activity>;
}

interface StaffPlanResult {
  readonly assignments: readonly PlannedStaff[];
  readonly activityIds: ReadonlySet<number>;
}

function validateOptions(options: AssignStaffOptions): void {
  const { roles } = options;
  if (roles.length === 0) throw new PlanningError('At least one staff role is required.');
  for (const role of roles) {
    if (!role.assignmentCode.startsWith('staff-')) {
      throw new PlanningError(`Invalid staff assignment code: ${role.assignmentCode}`);
    }
    if (!Number.isSafeInteger(role.count) || role.count < 0) {
      throw new PlanningError(`Count for ${role.assignmentCode} must be non-negative.`);
    }
  }
  if (
    options.loadPenalty !== undefined &&
    (!Number.isFinite(options.loadPenalty) || options.loadPenalty < 0)
  ) {
    throw new PlanningError(
      'The staff load penalty must be a non-negative finite number.',
    );
  }
}

function slotsFor(roles: readonly StaffRole[]): StaffSlot[] {
  return roles.flatMap((role) =>
    Array.from({ length: role.count }, (_, index) => ({
      assignmentCode: role.assignmentCode,
      stationNumber: role.stations ? index + 1 : null,
      ...(role.eligible ? { eligible: role.eligible } : {}),
    })),
  );
}

function hasConflict(
  person: Person,
  activity: Activity,
  replaced: ReplacedAssignment,
  planned: readonly PlannedStaff[],
  activityById: ReadonlyMap<number, Activity>,
): boolean {
  const assignedActivities = assignmentsOf(person)
    .filter((assignment) => !replaced(assignment))
    .map((assignment) => activityById.get(assignment.activityId))
    .filter((candidate): candidate is Activity => candidate !== undefined);
  const plannedActivities = planned
    .filter((entry) => personKey(entry.person) === personKey(person))
    .map((entry) => activityById.get(entry.assignment.activityId))
    .filter((candidate): candidate is Activity => candidate !== undefined);
  return [...assignedActivities, ...plannedActivities].some((assigned) =>
    overlaps(activity, assigned),
  );
}

function scoreCandidate(
  competition: Competition,
  person: Person,
  activity: Activity,
  slot: StaffSlot,
  preferences: readonly StaffScorer[],
  assignmentCount: number,
  loadPenalty: number,
): number {
  const context = {
    competition,
    activity,
    assignmentCode: slot.assignmentCode,
    stationNumber: slot.stationNumber,
    assignmentCount,
  };
  const preferenceScore = preferences.reduce(
    (sum, score) => sum + score(person, context),
    0,
  );
  if (!Number.isFinite(preferenceScore)) {
    throw new PlanningError('A staff preference returned a non-finite score.');
  }
  return preferenceScore - assignmentCount * loadPenalty;
}

function constraintsForActivity(
  context: StaffPlanningContext,
  activity: Activity,
  planned: readonly PlannedStaff[],
): readonly MatchingConstraint<StaffSlot, Person>[] {
  const { competition, options, replaced, activityById } = context;
  return [
    {
      name: 'role eligibility',
      allows: (slot, person) => slot.eligible?.(person) ?? true,
    },
    {
      name: 'no overlapping assignments',
      allows: (_slot, person) =>
        !hasConflict(person, activity, replaced, planned, activityById),
    },
    ...(options.constraints ?? []).map((constraint) => ({
      name: constraint.name,
      allows: (slot: StaffSlot, person: Person) =>
        constraint.allows(person, activity, slot.assignmentCode, competition),
    })),
  ];
}

function planActivity(
  context: StaffPlanningContext,
  activity: Activity,
  planned: readonly PlannedStaff[],
): PlannedStaff[] {
  const { competition, candidates, slots, options, counts } = context;
  const constraints = constraintsForActivity(context, activity, planned);
  const matched = solveMatching({
    items: slots,
    bins: candidates,
    capacities: candidates.map(() => 1),
    constraints,
    score: (slot, person) =>
      scoreCandidate(
        competition,
        person,
        activity,
        slot,
        options.preferences ?? [],
        counts.get(personKey(person)) ?? 0,
        options.loadPenalty ?? DEFAULT_LOAD_PENALTY,
      ),
    describeItem: (slot) => slot.assignmentCode,
  });
  return slots.map((slot) => {
    const person = matched.get(slot);
    if (!person)
      throw new PlanningError(`No person was selected for ${slot.assignmentCode}.`);
    return {
      person,
      assignment: {
        activityId: activity.id,
        assignmentCode: slot.assignmentCode,
        stationNumber: slot.stationNumber,
      },
    };
  });
}

function activitySlack(
  context: StaffPlanningContext,
  activity: Activity,
  planned: readonly PlannedStaff[],
): number {
  const { candidates, slots } = context;
  const constraints = constraintsForActivity(context, activity, planned);
  return Math.min(
    ...slots.map(
      (slot) =>
        candidates.filter((person) =>
          constraints.every((constraint) => constraint.allows(slot, person)),
        ).length,
    ),
  );
}

function nextActivity(
  context: StaffPlanningContext,
  remaining: readonly Activity[],
  planned: readonly PlannedStaff[],
): Activity | undefined {
  return remaining
    .map((activity) => ({
      activity,
      slack: activitySlack(context, activity, planned),
    }))
    .sort(
      (first, second) =>
        first.slack - second.slack ||
        Date.parse(first.activity.startTime) - Date.parse(second.activity.startTime) ||
        first.activity.id - second.activity.id,
    )[0]?.activity;
}

function planActivities(
  context: StaffPlanningContext,
  selectedActivities: readonly Activity[],
): StaffPlanResult {
  const planned: PlannedStaff[] = [];
  const plannedActivityIds = new Set<number>();
  const remaining = [...selectedActivities];

  while (remaining.length > 0) {
    const activity = nextActivity(context, remaining, planned);
    if (!activity) break;
    remaining.splice(remaining.indexOf(activity), 1);
    const activityPlan = planActivity(context, activity, planned);
    planned.push(...activityPlan);
    plannedActivityIds.add(activity.id);
    for (const { person } of activityPlan) {
      context.counts.set(
        personKey(person),
        (context.counts.get(personKey(person)) ?? 0) + 1,
      );
    }
  }

  return { assignments: planned, activityIds: plannedActivityIds };
}

function applyPlan(
  competition: Competition,
  plan: readonly PlannedStaff[],
  replaced: ReplacedAssignment,
): void {
  const additions = new Map<string, Assignment[]>();
  for (const { person, assignment } of plan) {
    const key = personKey(person);
    const current = additions.get(key) ?? [];
    current.push(assignment);
    additions.set(key, current);
  }

  for (const person of competition.persons) {
    const current = assignmentsOf(person);
    const retained = current.filter((assignment) => !replaced(assignment));
    person.assignments = [...retained, ...(additions.get(personKey(person)) ?? [])];
  }
}

function assignmentCounts(
  competition: Competition,
  replaced: ReplacedAssignment,
): Map<string, number> {
  return new Map(
    competition.persons.map((person) => [
      personKey(person),
      assignmentsOf(person).filter(
        (assignment) =>
          assignment.assignmentCode !== 'competitor' && !replaced(assignment),
      ).length,
    ]),
  );
}

function replacementFor(
  activityIds: ReadonlySet<number>,
  roles: readonly StaffRole[],
  mode: AssignStaffOptions['replaceExisting'],
): ReplacedAssignment {
  const roleCodes = new Set<string>(roles.map((role) => role.assignmentCode));
  return (assignment) =>
    activityIds.has(assignment.activityId) &&
    assignment.assignmentCode.startsWith('staff-') &&
    (mode !== 'same-roles' || roleCodes.has(assignment.assignmentCode));
}

export function assignStaff(
  competition: Competition,
  roundId: string,
  options: AssignStaffOptions,
): AssignmentSummary {
  validateOptions(options);
  const selectedActivities = groupsForRound(competition, roundId)
    .filter(options.groups ?? (() => true))
    .sort((first, second) => Date.parse(first.startTime) - Date.parse(second.startTime));
  if (selectedActivities.length === 0) {
    throw new PlanningError(`No groups are available for ${roundId}.`);
  }

  const candidates = shuffled(
    competition.persons.filter(options.select ?? accepted),
    options.seed ?? `${roundId}:staff`,
  );
  const slots = slotsFor(options.roles);
  const activityIds = new Set(selectedActivities.map((activity) => activity.id));
  const replaced = replacementFor(activityIds, options.roles, options.replaceExisting);
  const result = planActivities(
    {
      competition,
      candidates,
      slots,
      options,
      replaced,
      counts: assignmentCounts(competition, replaced),
      activityById: new Map(
        activities(competition).map(({ activity }) => [activity.id, activity]),
      ),
    },
    selectedActivities,
  );

  applyPlan(competition, result.assignments, replaced);
  return {
    assigned: result.assignments.length,
    activities: result.activityIds.size,
  };
}

export function assignStaffToActivity(
  competition: Competition,
  activityId: number,
  options: Omit<AssignStaffOptions, 'groups'>,
): AssignmentSummary {
  validateOptions(options);
  const activity = findActivity(competition, activityId)?.activity;
  if (!activity) throw new PlanningError(`Activity ${activityId} does not exist.`);
  const candidates = shuffled(
    competition.persons.filter(options.select ?? accepted),
    options.seed ?? `${activityId}:staff`,
  );
  const activityIds = new Set([activityId]);
  const replaced = replacementFor(activityIds, options.roles, options.replaceExisting);
  const plan = planActivity(
    {
      competition,
      candidates,
      slots: slotsFor(options.roles),
      options,
      replaced,
      counts: assignmentCounts(competition, replaced),
      activityById: new Map(
        activities(competition).map(({ activity: candidate }) => [
          candidate.id,
          candidate,
        ]),
      ),
    },
    activity,
    [],
  );
  applyPlan(competition, plan, replaced);
  return { assigned: plan.length, activities: 1 };
}
