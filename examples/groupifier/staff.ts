import {
  type Activity,
  activitiesOverlap,
  type Competition,
  findActivity,
  type Person,
  parseActivityCode,
} from '@speedcubingireland/typecomp';
import { bestAverageAndSingle } from './competitors';
import type { AssignmentOptions } from './config';
import { type OrderKey, orderBy } from './order';

export type GroupifierStaffRole = 'staff-scrambler' | 'staff-runner' | 'staff-judge';

const UPCOMING_COMPETITION_WINDOW_MS = 15 * 60 * 1_000;
const LONG_GAP_BEFORE_MS = 60 * 60 * 1_000;
const LONG_GAP_AFTER_MS = 30 * 60 * 1_000;
const MILLISECONDS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1_000;
const MINIMUM_STAFF_AGE = 10;
const SCRAMBLER_LOAD_BUCKET = 3;
const GENERAL_LOAD_BUCKET = 6;
const BUSY_ROLES = new Set(['staff-dataentry', 'delegate', 'organizer', 'staff-other']);

function assignedActivity(competition: Competition, activityId: number): Activity {
  const activity = findActivity(competition, activityId)?.activity;
  if (!activity) throw new Error(`Assignment refers to missing activity ${activityId}.`);
  return activity;
}

function availableDuring(
  competition: Competition,
  activity: Activity,
  person: Person,
): boolean {
  return !(person.assignments ?? []).some((assignment) =>
    activitiesOverlap(assignedActivity(competition, assignment.activityId), activity),
  );
}

function staffAssignmentCount(person: Person): number {
  return (person.assignments ?? []).filter((assignment) =>
    assignment.assignmentCode.startsWith('staff-'),
  ).length;
}

function staffAssignmentsForEvent(
  competition: Competition,
  person: Person,
  eventId: string,
): number {
  return (person.assignments ?? []).filter((assignment) => {
    if (!assignment.assignmentCode.startsWith('staff-')) return false;
    return (
      parseActivityCode(assignedActivity(competition, assignment.activityId).activityCode)
        ?.eventId === eventId
    );
  }).length;
}

function age(person: Person): number {
  return person.birthdate
    ? Math.floor((Date.now() - Date.parse(person.birthdate)) / MILLISECONDS_PER_YEAR)
    : 0;
}

function normalizedRoles(person: Person): Set<string> {
  return new Set(
    (person.roles ?? []).map((role) => (role === 'trainee-delegate' ? 'delegate' : role)),
  );
}

function busyRoleCount(person: Person): number {
  const roles = normalizedRoles(person);
  return [...BUSY_ROLES].filter((role) => roles.has(role)).length;
}

function competesSoon(competition: Competition, person: Person, time: string): boolean {
  const starts = (person.assignments ?? [])
    .filter((assignment) => assignment.assignmentCode === 'competitor')
    .map((assignment) => assignedActivity(competition, assignment.activityId).startTime)
    .filter((start) => start >= time)
    .sort();
  const next = starts[0];
  return (
    next !== undefined &&
    Date.parse(next) - Date.parse(time) <= UPCOMING_COMPETITION_WINDOW_MS
  );
}

function presence(competition: Competition, person: Person, time: string): number {
  const day = time.slice(0, 10);
  const assigned = (person.assignments ?? [])
    .map((assignment) => assignedActivity(competition, assignment.activityId))
    .filter((activity) => activity.startTime.slice(0, 10) === day);
  if (assigned.length === 0) return 0;
  const starts = assigned.map((activity) => activity.startTime).sort();
  const ends = assigned.map((activity) => activity.endTime).sort();
  const first = starts[0];
  if (first && first > time) return 1 + 1 / (Date.parse(first) - Date.parse(time));
  const previous = [...ends].reverse().find((end) => end <= time);
  const next = starts.find((start) => start >= time);
  if (
    previous &&
    next &&
    Date.parse(time) - Date.parse(previous) > LONG_GAP_BEFORE_MS &&
    Date.parse(next) - Date.parse(time) > LONG_GAP_BEFORE_MS
  )
    return 3;
  if (previous && !next && Date.parse(time) - Date.parse(previous) > LONG_GAP_AFTER_MS)
    return 2;
  return 4;
}

function suitability(person: Person, eventId: string): number {
  const result = person.personalBests?.some((best) => best.eventId === eventId) ?? false;
  const registered =
    person.registration?.eventIds.some((registered) => registered === eventId) ?? false;
  return Number(result) * 2 + Number(registered);
}

function commonPriority(
  competition: Competition,
  person: Person,
  activity: Activity,
  eventId: string,
  options: AssignmentOptions,
): OrderKey {
  return [
    options.noTasksForNewcomers && !person.wcaId ? 1 : -1,
    options.tasksForOwnEventsOnly &&
    !person.registration?.eventIds.some((registered) => registered === eventId)
      ? 1
      : -1,
    age(person) >= MINIMUM_STAFF_AGE ? -1 : 1,
    busyRoleCount(person),
    staffAssignmentsForEvent(competition, person, eventId) >= 2 ? 1 : -1,
    -presence(competition, person, activity.startTime),
  ];
}

function scramblerPriority(
  competition: Competition,
  person: Person,
  activity: Activity,
  eventId: string,
  options: AssignmentOptions,
): OrderKey {
  return [
    options.noTasksForNewcomers && !person.wcaId ? 1 : -1,
    age(person) >= MINIMUM_STAFF_AGE ? -1 : 1,
    -suitability(person, eventId),
    busyRoleCount(person),
    staffAssignmentsForEvent(competition, person, eventId) >= 2 ? 1 : -1,
    -presence(competition, person, activity.startTime),
    Math.floor(staffAssignmentCount(person) / GENERAL_LOAD_BUCKET),
    competesSoon(competition, person, activity.endTime) ? 1 : -1,
    ...bestAverageAndSingle(person, eventId),
  ];
}

function regularPriority(
  competition: Competition,
  person: Person,
  activity: Activity,
  eventId: string,
  role: GroupifierStaffRole,
  options: AssignmentOptions,
): OrderKey {
  const common = commonPriority(competition, person, activity, eventId, options);
  if (role === 'staff-runner') {
    return [
      options.noRunningForForeigners &&
      person.countryIso2 !== competition.schedule.venues[0]?.countryIso2
        ? 1
        : -1,
      ...common,
      staffAssignmentCount(person),
      competesSoon(competition, person, activity.endTime) ? 1 : -1,
    ];
  }
  if (role === 'staff-judge') {
    return [
      ...common,
      staffAssignmentCount(person),
      competesSoon(competition, person, activity.endTime) ? 1 : -1,
      person.registration?.eventIds.length ?? 0,
    ];
  }
  return scramblerPriority(competition, person, activity, eventId, options);
}

function designatedPriority(
  competition: Competition,
  person: Person,
  activity: Activity,
  role: GroupifierStaffRole,
  eventId: string,
): OrderKey {
  if (role === 'staff-scrambler') {
    return [
      Math.floor(staffAssignmentCount(person) / SCRAMBLER_LOAD_BUCKET),
      ...bestAverageAndSingle(person, eventId),
    ];
  }
  return [
    staffAssignmentCount(person),
    competesSoon(competition, person, activity.endTime) ? 1 : -1,
  ];
}

export function selectStaff(
  competition: Competition,
  activity: Activity,
  eventId: string,
  role: GroupifierStaffRole,
  count: number,
  options: AssignmentOptions,
  competitorIds: ReadonlySet<number>,
): Person[] {
  const accepted = competition.persons.filter(
    (person) => person.registration?.status === 'accepted',
  );
  const available = accepted.filter((person) =>
    availableDuring(competition, activity, person),
  );
  const designated = available.filter((person) => person.roles?.includes(role));
  const designatedIds = new Set(designated.map((person) => person.wcaUserId));
  const regular = available.filter(
    (person) =>
      !designatedIds.has(person.wcaUserId) &&
      (role !== 'staff-scrambler' ||
        (person.registrantId !== null && competitorIds.has(person.registrantId))),
  );
  const orderedDesignated = orderBy(designated, (person) =>
    designatedPriority(competition, person, activity, role, eventId),
  );
  const orderedRegular =
    orderedDesignated.length >= count
      ? []
      : orderBy(regular, (person) =>
          regularPriority(competition, person, activity, eventId, role, options),
        );
  return [...orderedDesignated, ...orderedRegular].slice(0, count);
}
