import { activities, type Competition, parseRoundId } from '@speedcubingireland/typecomp';
import type { GroupifierOptions, RoundActivityOptions, RoundOptions } from './config';

const CAPACITY_TOLERANCE = 1e-9;

export type ResolvedActivityOptions = Omit<RoundActivityOptions, 'target'> & {
  readonly activityId: number;
  readonly room: string;
  readonly stations: number;
};

export interface ResolvedRoundOptions {
  readonly roundId: string;
  readonly activities: readonly ResolvedActivityOptions[];
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function validateRooms(options: GroupifierOptions): ReadonlySet<string> {
  const rooms = new Set<string>();
  for (const room of options.rooms) {
    if (rooms.has(room.room)) {
      throw new TypeError(`Room ${room.room} is configured twice.`);
    }
    rooms.add(room.room);
    nonNegativeInteger(room.stations, `Stations in ${room.room}`);
  }
  return rooms;
}

function validateRound(round: RoundOptions, rooms: ReadonlySet<string>): void {
  parseRoundId(round.roundId);
  if (round.activities.length === 0) {
    throw new TypeError(`Round ${round.roundId} has no activity configuration.`);
  }
  const capacity = round.activities.reduce((sum, activity) => sum + activity.capacity, 0);
  if (!Number.isFinite(capacity) || Math.abs(capacity - 1) > CAPACITY_TOLERANCE) {
    throw new TypeError(`Capacities for ${round.roundId} must add up to one.`);
  }
  for (const activity of round.activities) {
    const label =
      'room' in activity.target
        ? activity.target.room
        : `activity ${activity.target.activityId}`;
    if ('room' in activity.target && !rooms.has(activity.target.room)) {
      throw new TypeError(`Room ${activity.target.room} has no station configuration.`);
    }
    if (!Number.isFinite(activity.capacity) || activity.capacity <= 0) {
      throw new TypeError(`Capacity for ${round.roundId} in ${label} must be positive.`);
    }
    positiveInteger(activity.groups, `Groups for ${round.roundId} in ${label}`);
    nonNegativeInteger(
      activity.scramblers,
      `Scramblers for ${round.roundId} in ${label}`,
    );
    nonNegativeInteger(activity.runners, `Runners for ${round.roundId} in ${label}`);
  }
}

export function validateOptions(options: GroupifierOptions): void {
  const rooms = validateRooms(options);
  const rounds = new Set<string>();
  for (const round of options.rounds) {
    if (rounds.has(round.roundId)) {
      throw new TypeError(`Round ${round.roundId} is configured twice.`);
    }
    rounds.add(round.roundId);
    validateRound(round, rooms);
  }
}

export function resolveOptions(
  competition: Competition,
  options: GroupifierOptions,
): ResolvedRoundOptions[] {
  const stations = new Map(options.rooms.map((room) => [room.room, room.stations]));
  const locatedActivities = activities(competition);
  const activityOrder = new Map(
    locatedActivities.map(({ activity }, index) => [activity.id, index]),
  );
  const roundOrder = new Map(
    competition.events
      .flatMap((event) => event.rounds)
      .map((round, index) => [round.id, index]),
  );
  return options.rounds
    .map(
      (round): ResolvedRoundOptions => ({
        roundId: round.roundId,
        activities: round.activities
          .map((configured): ResolvedActivityOptions => {
            const matches = locatedActivities.filter(
              ({ activity, room }) =>
                activity.activityCode === round.roundId &&
                ('room' in configured.target
                  ? room.name === configured.target.room
                  : activity.id === configured.target.activityId),
            );
            const located = matches[0];
            if (matches.length !== 1 || !located) {
              const target =
                'room' in configured.target
                  ? configured.target.room
                  : `activity ${configured.target.activityId}`;
              throw new TypeError(
                `${round.roundId} must have exactly one match for ${target}.`,
              );
            }
            const roomStations = stations.get(located.room.name);
            if (roomStations === undefined) {
              throw new TypeError(
                `Room ${located.room.name} has no station configuration.`,
              );
            }
            const { target: _target, ...values } = configured;
            return {
              ...values,
              activityId: located.activity.id,
              room: located.room.name,
              stations: roomStations,
            };
          })
          .sort(
            (first, second) =>
              (activityOrder.get(first.activityId) ?? Number.MAX_SAFE_INTEGER) -
              (activityOrder.get(second.activityId) ?? Number.MAX_SAFE_INTEGER),
          ),
      }),
    )
    .sort(
      (first, second) =>
        (roundOrder.get(first.roundId) ?? Number.MAX_SAFE_INTEGER) -
        (roundOrder.get(second.roundId) ?? Number.MAX_SAFE_INTEGER),
    );
}
