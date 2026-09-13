import { groupCode, parseRoundId } from '../domain/activity-code';
import { activities, copyAssignments, nextActivityId } from '../domain/competition';
import type { Activity, Competition, Room } from '../domain/types';
import { PlanningError } from '../errors';

export interface CreateGroupsOptions {
  readonly count: number;
  readonly room?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly replace?: boolean;
}

export interface CreatedGroups {
  readonly groups: readonly Activity[];
  readonly room: string;
  readonly removedAssignments: number;
}

export interface GroupBlock {
  readonly activityId: number;
  readonly count: number;
}

export interface CreateGroupsAcrossOptions {
  readonly blocks: readonly GroupBlock[];
  readonly replace?: boolean;
}

export interface CreatedRoundGroups {
  readonly groups: readonly Activity[];
  readonly rooms: readonly string[];
  readonly removedAssignments: number;
}

interface ScheduleTarget {
  readonly parent: Activity;
  readonly roomName: string;
}

interface GroupTarget extends ScheduleTarget {
  readonly count: number;
}

interface PendingGroup {
  readonly target: GroupTarget;
  readonly localIndex: number;
  readonly start: number;
  readonly end: number;
  activity?: Activity;
}

function findTarget(
  competition: Competition,
  roundId: string,
  roomName: string | undefined,
): ScheduleTarget {
  const candidates = activities(competition).filter(
    ({ activity, room }) =>
      activity.activityCode === roundId &&
      (roomName === undefined || room.name === roomName),
  );

  if (candidates.length === 1) {
    const [candidate] = candidates;
    if (candidate) return { parent: candidate.activity, roomName: candidate.room.name };
  }
  if (candidates.length > 1) {
    throw new PlanningError(`Round ${roundId} occurs in multiple rooms; specify a room.`);
  }
  if (!roomName) {
    throw new PlanningError(
      `Round ${roundId} is not scheduled; specify a room and times.`,
    );
  }

  return createParent(competition, roundId, roomName);
}

function findRoom(competition: Competition, roomName: string): Room {
  const matches = competition.schedule.venues.flatMap((venue) =>
    venue.rooms.filter((room) => room.name === roomName),
  );
  if (matches.length === 0) throw new PlanningError(`Room "${roomName}" does not exist.`);
  if (matches.length > 1) {
    throw new PlanningError(`Room name "${roomName}" is ambiguous across venues.`);
  }
  const room = matches[0];
  if (!room) throw new PlanningError(`Room "${roomName}" does not exist.`);
  return room;
}

function createParent(
  competition: Competition,
  roundId: string,
  roomName: string,
): ScheduleTarget {
  const room = findRoom(competition, roomName);
  const { eventId, roundNumber } = parseRoundId(roundId);
  const parent: Activity = {
    id: nextActivityId(competition),
    activityCode: roundId,
    name: `${eventId} Round ${roundNumber}`,
    startTime: '',
    endTime: '',
    childActivities: [],
    extensions: [],
  };
  room.activities.push(parent);
  return { parent, roomName };
}

function parseBoundary(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new PlanningError(`Invalid ${label}: ${value}`);
  return timestamp;
}

function timeBounds(parent: Activity, options: CreateGroupsOptions): [number, number] {
  const start = parseBoundary(options.startTime ?? parent.startTime, 'start time');
  const end = parseBoundary(options.endTime ?? parent.endTime, 'end time');
  if (start >= end) throw new PlanningError('Group start time must be before end time.');
  return [start, end];
}

function descendantIds(activity: Activity): number[] {
  return [
    activity.id,
    ...(activity.childActivities ?? []).flatMap((child) => descendantIds(child)),
  ];
}

function assertGroupCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new PlanningError('Group count must be a positive integer.');
  }
}

function createGroupsForTargets(
  competition: Competition,
  roundId: string,
  targets: readonly GroupTarget[],
  replace: boolean,
): CreatedRoundGroups {
  if (targets.length === 0)
    throw new PlanningError('At least one group block is required.');
  for (const target of targets) {
    assertGroupCount(target.count);
    if ((target.parent.childActivities?.length ?? 0) > 0 && !replace) {
      throw new PlanningError(`${roundId} already has child activities.`);
    }
  }

  const replacedIds = new Set(
    targets.flatMap(({ parent }) =>
      (parent.childActivities ?? []).flatMap((activity) => descendantIds(activity)),
    ),
  );
  const pending = targets.flatMap((target) => {
    const start = parseBoundary(target.parent.startTime, 'start time');
    const end = parseBoundary(target.parent.endTime, 'end time');
    if (start >= end)
      throw new PlanningError('Group start time must be before end time.');
    if (target.count > end - start) {
      throw new PlanningError('Each group must be at least one millisecond long.');
    }
    return Array.from(
      { length: target.count },
      (_, localIndex): PendingGroup => ({
        target,
        localIndex,
        start: start + Math.round(((end - start) * localIndex) / target.count),
        end: start + Math.round(((end - start) * (localIndex + 1)) / target.count),
      }),
    );
  });
  pending.sort((first, second) => first.start - second.start || first.end - second.end);

  let activityId = nextActivityId(competition);
  for (const [index, item] of pending.entries()) {
    const previous = item.target.parent.childActivities?.[item.localIndex];
    const activityCode = groupCode(roundId, index + 1);
    item.activity = {
      id: previous?.id ?? activityId++,
      activityCode,
      name: `${activityCode} · ${item.target.roomName}`,
      startTime: new Date(item.start).toISOString(),
      endTime: new Date(item.end).toISOString(),
      childActivities: [],
      extensions: [],
    };
  }
  for (const target of targets) {
    target.parent.childActivities = pending
      .filter((item) => item.target === target)
      .map((item) => item.activity)
      .filter((activity): activity is Activity => activity !== undefined);
  }

  const groups = pending
    .map((item) => item.activity)
    .filter((activity): activity is Activity => activity !== undefined);
  const retainedIds = new Set(groups.map((group) => group.id));
  const removedIds = new Set([...replacedIds].filter((id) => !retainedIds.has(id)));
  let removedAssignments = 0;
  for (const person of competition.persons) {
    const before = person.assignments?.length ?? 0;
    person.assignments = (person.assignments ?? []).filter(
      (assignment) => !removedIds.has(assignment.activityId),
    );
    removedAssignments += before - person.assignments.length;
  }
  return {
    groups,
    rooms: [...new Set(targets.map((target) => target.roomName))],
    removedAssignments,
  };
}

function createGroupsInDraft(
  competition: Competition,
  roundId: string,
  options: CreateGroupsOptions,
): CreatedGroups {
  parseRoundId(roundId);
  assertGroupCount(options.count);

  const target = findTarget(competition, roundId, options.room);
  const [start, end] = timeBounds(target.parent, options);
  target.parent.startTime = new Date(start).toISOString();
  target.parent.endTime = new Date(end).toISOString();
  const result = createGroupsForTargets(
    competition,
    roundId,
    [{ ...target, count: options.count }],
    options.replace !== false,
  );
  return {
    groups: result.groups,
    room: target.roomName,
    removedAssignments: result.removedAssignments,
  };
}

export function createGroups(
  competition: Competition,
  roundId: string,
  options: CreateGroupsOptions,
): CreatedGroups {
  const draft = structuredClone(competition);
  const result = createGroupsInDraft(draft, roundId, options);
  if (result.removedAssignments > 0) copyAssignments(competition, draft);
  competition.schedule = draft.schedule;
  return structuredClone(result);
}

export function createGroupsAcrossActivities(
  competition: Competition,
  roundId: string,
  options: CreateGroupsAcrossOptions,
): CreatedRoundGroups {
  parseRoundId(roundId);
  const draft = structuredClone(competition);
  const seen = new Set<number>();
  const targets = options.blocks.map(({ activityId, count }): GroupTarget => {
    if (seen.has(activityId)) {
      throw new PlanningError(`Activity ${activityId} is configured more than once.`);
    }
    seen.add(activityId);
    const located = activities(draft).find(({ activity }) => activity.id === activityId);
    if (!located || located.activity.activityCode !== roundId) {
      throw new PlanningError(`Activity ${activityId} is not a ${roundId} activity.`);
    }
    return { parent: located.activity, roomName: located.room.name, count };
  });
  const result = createGroupsForTargets(
    draft,
    roundId,
    targets,
    options.replace !== false,
  );
  if (result.removedAssignments > 0) copyAssignments(competition, draft);
  competition.schedule = draft.schedule;
  return structuredClone(result);
}
