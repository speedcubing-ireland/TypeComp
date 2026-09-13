import { parseActivityCode, parseRoundId, roundIdFor } from './activity-code';
import type {
  Activity,
  Assignment,
  Competition,
  Person,
  Room,
  Round,
  SchedulablePerson,
  Venue,
} from './types';

export interface LocatedActivity {
  readonly activity: Activity;
  readonly parent: Activity | null;
  readonly room: Room;
  readonly venue: Venue;
}

export interface LocatedAssignment {
  readonly person: Person;
  readonly assignment: Assignment;
}

function visitActivity(
  activity: Activity,
  room: Room,
  venue: Venue,
  parent: Activity | null,
  result: LocatedActivity[],
): void {
  result.push({ activity, parent, room, venue });
  for (const child of activity.childActivities ?? []) {
    visitActivity(child, room, venue, activity, result);
  }
}

export function activities(competition: Competition): LocatedActivity[] {
  const result: LocatedActivity[] = [];
  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      for (const activity of room.activities) {
        visitActivity(activity, room, venue, null, result);
      }
    }
  }
  return result;
}

export function findActivity(
  competition: Competition,
  activityId: number,
): LocatedActivity | undefined {
  return activities(competition).find(({ activity }) => activity.id === activityId);
}

export function assignmentsForActivity(
  competition: Competition,
  activityId: number,
): LocatedAssignment[] {
  return competition.persons.flatMap((person) =>
    assignmentsOf(person)
      .filter((assignment) => assignment.activityId === activityId)
      .map((assignment) => ({ person, assignment })),
  );
}

export function findRound(competition: Competition, roundId: string): Round {
  const { eventId } = parseRoundId(roundId);
  const round = competition.events
    .find((event) => event.id === eventId)
    ?.rounds.find((candidate) => candidate.id === roundId);

  if (!round) throw new RangeError(`Round ${roundId} does not exist.`);
  return round;
}

export function groupsForRound(competition: Competition, roundId: string): Activity[] {
  parseRoundId(roundId);
  return activities(competition)
    .map(({ activity }) => activity)
    .filter((activity) => {
      const parsed = parseActivityCode(activity.activityCode);
      return (
        parsed !== null &&
        parsed.groupNumber !== null &&
        parsed.attemptNumber === null &&
        roundIdFor(activity) === roundId
      );
    })
    .sort((first, second) => {
      const firstNumber = parseActivityCode(first.activityCode)?.groupNumber ?? 0;
      const secondNumber = parseActivityCode(second.activityCode)?.groupNumber ?? 0;
      return firstNumber - secondNumber || first.id - second.id;
    });
}

export function schedulablePeople(competition: Competition): SchedulablePerson[] {
  return competition.persons.filter((person): person is SchedulablePerson =>
    Number.isSafeInteger(person.registrantId),
  );
}

export function personById(
  competition: Competition,
  registrantId: number,
): SchedulablePerson | undefined {
  return schedulablePeople(competition).find(
    (person) => person.registrantId === registrantId,
  );
}

export function nextActivityId(competition: Competition): number {
  return (
    activities(competition).reduce(
      (maximum, { activity }) => Math.max(maximum, activity.id),
      0,
    ) + 1
  );
}

export function roundEntrants(
  competition: Competition,
  roundId: string,
): SchedulablePerson[] {
  const { eventId, roundNumber } = parseRoundId(roundId);
  const round = findRound(competition, roundId);
  const people = schedulablePeople(competition);

  if (roundNumber > 1) {
    if (round.results.length === 0) {
      throw new RangeError(
        `${roundId} has no live-result entrants. Synchronize results or provide an explicit selector.`,
      );
    }
    const entrantIds = new Set(round.results.map((result) => result.personId));
    return people.filter((person) => entrantIds.has(person.registrantId));
  }

  return people.filter((person) => {
    const registration = person.registration;
    return (
      registration?.status === 'accepted' &&
      registration.isCompeting &&
      registration.eventIds.some((id) => id === eventId)
    );
  });
}

export function cloneCompetition(competition: Competition): Competition {
  return structuredClone(competition);
}

export function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function assignmentsOf(person: Person) {
  return person.assignments ?? [];
}

export function assignmentsState(assignments: readonly Assignment[] | undefined): string {
  return stableJson(assignments?.map(stableJson).sort() ?? []);
}

export function personKey(person: Person): string {
  return person.registrantId === null
    ? `user:${person.wcaUserId}`
    : `registrant:${person.registrantId}`;
}

export function assignmentsByPerson(
  competition: Competition,
): ReadonlyMap<string, ReturnType<typeof assignmentsOf>> {
  const result = new Map<string, ReturnType<typeof assignmentsOf>>();
  for (const person of competition.persons) {
    const key = personKey(person);
    if (result.has(key)) throw new TypeError(`Duplicate person identity: ${key}.`);
    result.set(key, assignmentsOf(person));
  }
  return result;
}

export function copyAssignments(target: Competition, source: Competition): void {
  assignmentsByPerson(target);
  const sourceAssignments = assignmentsByPerson(source);
  for (const person of target.persons) {
    person.assignments = structuredClone(sourceAssignments.get(personKey(person)) ?? []);
  }
}
