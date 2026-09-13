import { parseActivityCode, roundIdFor } from './domain/activity-code';
import { activities, assignmentsOf, findRound, personKey } from './domain/competition';
import { overlaps } from './domain/time';
import type { Activity, Assignment, Competition, Person } from './domain/types';
import { TypeCompError } from './errors';

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

function duplicateActivityIssues(competition: Competition): ValidationIssue[] {
  const seen = new Set<number>();
  return activities(competition).flatMap(({ activity }) => {
    if (!Number.isSafeInteger(activity.id) || activity.id < 1) {
      return [
        {
          severity: 'error' as const,
          code: 'INVALID_ACTIVITY_ID',
          message: `Activity id ${activity.id} must be a positive integer.`,
          path: `schedule.activity[${activity.id}]`,
        },
      ];
    }
    if (seen.has(activity.id)) {
      return [
        {
          severity: 'error' as const,
          code: 'DUPLICATE_ACTIVITY_ID',
          message: `Activity id ${activity.id} is not unique.`,
          path: `schedule.activity[${activity.id}]`,
        },
      ];
    }
    seen.add(activity.id);
    return [];
  });
}

function activityTimeIssues(
  activity: Activity,
  parent: Activity | null,
): ValidationIssue[] {
  const start = Date.parse(activity.startTime);
  const end = Date.parse(activity.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return [
      {
        severity: 'error',
        code: 'INVALID_ACTIVITY_TIME',
        message: `Activity ${activity.id} must have a valid, positive duration.`,
        path: `schedule.activity[${activity.id}]`,
      },
    ];
  }
  if (!parent) return [];
  const parentStart = Date.parse(parent.startTime);
  const parentEnd = Date.parse(parent.endTime);
  if (
    !Number.isFinite(parentStart) ||
    !Number.isFinite(parentEnd) ||
    (start >= parentStart && end <= parentEnd)
  ) {
    return [];
  }
  return [
    {
      severity: 'error',
      code: 'CHILD_OUTSIDE_PARENT',
      message: `Activity ${activity.id} must occur within its parent activity.`,
      path: `schedule.activity[${activity.id}]`,
    },
  ];
}

function roundReferenceIssues(
  competition: Competition,
  activity: Activity,
): ValidationIssue[] {
  const parsed = parseActivityCode(activity.activityCode);
  const roundId = roundIdFor(activity);
  if (!parsed || !roundId) return [];
  try {
    findRound(competition, roundId);
    return [];
  } catch {
    return [
      {
        severity: 'error',
        code: 'ORPHAN_ROUND_ACTIVITY',
        message: `${activity.activityCode} refers to a missing round.`,
        path: `schedule.activity[${activity.id}].activityCode`,
      },
    ];
  }
}

function activityCodeIssues(
  activity: Activity,
  parent: Activity | null,
): ValidationIssue[] {
  if (!parent) return [];
  const parentCode = parseActivityCode(parent.activityCode);
  const childCode = parseActivityCode(activity.activityCode);
  if (!parentCode || !childCode) return [];
  const containsParent =
    parentCode.eventId === childCode.eventId &&
    parentCode.roundNumber === childCode.roundNumber &&
    (parentCode.groupNumber === null ||
      parentCode.groupNumber === childCode.groupNumber) &&
    (parentCode.attemptNumber === null ||
      parentCode.attemptNumber === childCode.attemptNumber);
  if (containsParent) return [];
  return [
    {
      severity: 'error',
      code: 'INVALID_ACTIVITY_NESTING',
      message: `${activity.activityCode} does not contain its parent activity code.`,
      path: `schedule.activity[${activity.id}].activityCode`,
    },
  ];
}

function scheduleIssues(competition: Competition): ValidationIssue[] {
  return activities(competition).flatMap(({ activity, parent }) => [
    ...activityTimeIssues(activity, parent),
    ...activityCodeIssues(activity, parent),
    ...roundReferenceIssues(competition, activity),
  ]);
}

function personIdentityIssues(competition: Competition): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  const seen = new Set<string>();
  const seenUsers = new Set<number>();
  for (const [index, person] of competition.persons.entries()) {
    const path = `persons[${index}]`;
    if (
      person.registrantId !== null &&
      (!Number.isSafeInteger(person.registrantId) || person.registrantId < 1)
    ) {
      result.push({
        severity: 'error',
        code: 'INVALID_REGISTRANT_ID',
        message: 'Registrant ids must be positive integers or null.',
        path: `${path}.registrantId`,
      });
    }
    if (!Number.isSafeInteger(person.wcaUserId) || person.wcaUserId < 1) {
      result.push({
        severity: 'error',
        code: 'INVALID_WCA_USER_ID',
        message: 'WCA user ids must be positive integers.',
        path: `${path}.wcaUserId`,
      });
    } else if (seenUsers.has(person.wcaUserId)) {
      result.push({
        severity: 'error',
        code: 'DUPLICATE_WCA_USER_ID',
        message: `WCA user id ${person.wcaUserId} is not unique.`,
        path: `${path}.wcaUserId`,
      });
    }
    seenUsers.add(person.wcaUserId);
    const key = personKey(person);
    if (seen.has(key)) {
      result.push({
        severity: 'error',
        code: 'DUPLICATE_PERSON_ID',
        message: `Person identity ${key} is not unique.`,
        path,
      });
    }
    seen.add(key);
  }
  return result;
}

function assignmentPath(person: Person, index: number): string {
  const identity =
    person.registrantId === null ? `user:${person.wcaUserId}` : person.registrantId;
  return `persons[${identity}].assignments[${index}]`;
}

function singleAssignmentIssues(
  person: Person,
  assignment: Assignment,
  index: number,
  activityById: ReadonlyMap<number, Activity>,
  seen: Set<string>,
  occupiedStations: Set<string>,
): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  const path = assignmentPath(person, index);
  if (!activityById.has(assignment.activityId)) {
    result.push({
      severity: 'error',
      code: 'ORPHAN_ASSIGNMENT',
      message: `Assignment refers to missing activity ${assignment.activityId}.`,
      path,
    });
  }
  const key = `${assignment.activityId}:${assignment.assignmentCode}:${assignment.stationNumber}`;
  if (seen.has(key)) {
    result.push({
      severity: 'error',
      code: 'DUPLICATE_ASSIGNMENT',
      message: 'The same assignment appears more than once.',
      path,
    });
  }
  seen.add(key);
  if (assignment.stationNumber !== null) {
    if (!Number.isSafeInteger(assignment.stationNumber) || assignment.stationNumber < 1) {
      result.push({
        severity: 'error',
        code: 'INVALID_STATION',
        message: 'Station numbers must be positive integers.',
        path: `${path}.stationNumber`,
      });
    } else {
      const stationKey = `${assignment.activityId}:${assignment.assignmentCode}:${assignment.stationNumber}`;
      if (occupiedStations.has(stationKey)) {
        result.push({
          severity: 'error',
          code: 'DUPLICATE_STATION',
          message: 'The same station is assigned more than once for this role.',
          path: `${path}.stationNumber`,
        });
      }
      occupiedStations.add(stationKey);
    }
  }
  return result;
}

function assignmentOverlapIssue(
  person: Person,
  first: Assignment,
  second: Assignment,
  firstActivity: Activity,
  secondActivity: Activity,
): ValidationIssue {
  const firstCode = parseActivityCode(firstActivity.activityCode);
  const secondCode = parseActivityCode(secondActivity.activityCode);
  if (
    first.assignmentCode === 'competitor' &&
    second.assignmentCode === 'competitor' &&
    first.activityId !== second.activityId &&
    firstCode !== null &&
    secondCode !== null &&
    firstCode.groupNumber !== null &&
    firstCode.groupNumber === secondCode.groupNumber &&
    firstCode.eventId !== secondCode.eventId &&
    firstActivity.startTime === secondActivity.startTime &&
    firstActivity.endTime === secondActivity.endTime
  ) {
    return {
      severity: 'warning',
      code: 'OVERLAPPING_COMPETITOR_ASSIGNMENTS',
      message: `${person.name} has overlapping competitor assignments.`,
      path: `persons[${person.registrantId}].assignments`,
    };
  }
  return {
    severity: 'error',
    code: 'ASSIGNMENT_TIME_CONFLICT',
    message: `${person.name} has overlapping assignments.`,
    path: `persons[${person.registrantId}].assignments`,
  };
}

function timeConflictIssues(
  person: Person,
  assignments: readonly Assignment[],
  activityById: ReadonlyMap<number, Activity>,
): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  for (let first = 0; first < assignments.length; first += 1) {
    for (let second = first + 1; second < assignments.length; second += 1) {
      const a = activityById.get(assignments[first]?.activityId ?? -1);
      const b = activityById.get(assignments[second]?.activityId ?? -1);
      if (!a || !b || !overlaps(a, b)) continue;
      const firstAssignment = assignments[first];
      const secondAssignment = assignments[second];
      if (firstAssignment && secondAssignment) {
        result.push(
          assignmentOverlapIssue(person, firstAssignment, secondAssignment, a, b),
        );
      }
    }
  }
  return result;
}

function assignmentIssues(competition: Competition): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  const activityById = new Map(
    activities(competition).map(({ activity }) => [activity.id, activity]),
  );
  const occupiedStations = new Set<string>();
  for (const person of competition.persons) {
    const assignments = assignmentsOf(person);
    const seen = new Set<string>();
    for (const [index, assignment] of assignments.entries()) {
      result.push(
        ...singleAssignmentIssues(
          person,
          assignment,
          index,
          activityById,
          seen,
          occupiedStations,
        ),
      );
    }
    result.push(...timeConflictIssues(person, assignments, activityById));
  }
  return result;
}

export function validateCompetition(competition: Competition): ValidationIssue[] {
  const issues = [
    ...duplicateActivityIssues(competition),
    ...scheduleIssues(competition),
    ...personIdentityIssues(competition),
    ...assignmentIssues(competition),
  ];
  if (!competition.formatVersion) {
    issues.unshift({
      severity: 'error',
      code: 'MISSING_FORMAT_VERSION',
      message: 'WCIF formatVersion is required.',
      path: 'formatVersion',
    });
  } else if (competition.formatVersion !== '1.2') {
    issues.unshift({
      severity: 'error',
      code: 'UNSUPPORTED_FORMAT_VERSION',
      message: `WCIF version ${competition.formatVersion} is not supported.`,
      path: 'formatVersion',
    });
  }
  return issues;
}

export function assertValidCompetition(competition: Competition): void {
  const errors = validateCompetition(competition).filter(
    (issue) => issue.severity === 'error',
  );
  if (errors.length > 0) {
    throw new TypeCompError(
      `Competition has ${errors.length} validation error${errors.length === 1 ? '' : 's'}.`,
      'INVALID_COMPETITION',
      { errors: errors.length },
    );
  }
}
