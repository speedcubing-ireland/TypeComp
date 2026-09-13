import {
  type Activity,
  activitiesOverlap,
  type Competition,
  findActivity,
  type GroupAssignmentStrategy,
  groupNumber,
  type Person,
  parseRoundId,
  personalBest,
  type SchedulablePerson,
} from '@speedcubingireland/typecomp';
import type { CompetitorSortingRule } from './config';
import { orderBy } from './order';

const BALANCED_BY_RANKING = new Set([
  '333',
  '222',
  '333bf',
  '333oh',
  '333ft',
  'pyram',
  'skewb',
  'clock',
  'sq1',
]);
const COVERAGE_ROLES = new Set(['staff-dataentry', 'delegate', 'organizer']);

interface PlannedGroup {
  readonly activity: Activity;
  readonly size: number;
  readonly members: SchedulablePerson[];
}

function best(person: Person, eventId: string, type: 'average' | 'single') {
  return personalBest(person, eventId, type) ?? Infinity;
}

export function bestAverageAndSingle(
  person: Person,
  eventId: string,
): readonly [number, number] {
  const blindfolded =
    eventId === '333bf' ||
    eventId === '444bf' ||
    eventId === '555bf' ||
    eventId === '333mbf';
  return blindfolded
    ? [best(person, eventId, 'single'), best(person, eventId, 'average')]
    : [best(person, eventId, 'average'), best(person, eventId, 'single')];
}

function rankedEntrants(
  competition: Competition,
  roundId: string,
  people: readonly SchedulablePerson[],
): SchedulablePerson[] {
  const { eventId, roundNumber } = parseRoundId(roundId);
  if (roundNumber === 1) {
    return orderBy(people, (person) => {
      const [primary, secondary] = bestAverageAndSingle(person, eventId);
      return [-primary, -secondary, person.name];
    });
  }
  const rounds = competition.events.find((event) => event.id === eventId)?.rounds ?? [];
  const previous = rounds.find((round) => round.id === `${eventId}-r${roundNumber - 1}`);
  const ranking = new Map(
    (previous?.results ?? []).map((result) => [
      result.personId,
      result.ranking ?? people.length,
    ]),
  );
  return orderBy(people, (person) => [
    -(ranking.get(person.registrantId) ?? people.length),
  ]);
}

function symmetricallyOrdered(
  people: readonly SchedulablePerson[],
  groupCount: number,
): SchedulablePerson[] {
  const position = new Map(people.map((person, index) => [person.registrantId, index]));
  return orderBy(people, (person) => {
    const index = position.get(person.registrantId) ?? 0;
    return [groupCount - ((people.length - index - 1) % groupCount)];
  });
}

function firstName(person: SchedulablePerson): string {
  return person.name.split(' ')[0] ?? '';
}

function nameOptimised(people: readonly SchedulablePerson[]): SchedulablePerson[] {
  const byName = new Map<string, SchedulablePerson[]>();
  for (const person of people) {
    const name = firstName(person);
    byName.set(name, [...(byName.get(name) ?? []), person]);
  }
  const sets = [...byName.values()].sort((first, second) => first.length - second.length);
  const first = sets[0];
  if (!first) return [];
  return sets.slice(1).reduce<SchedulablePerson[]>(
    (arranged, sameName) => {
      const chunkSize = Math.ceil(arranged.length / sameName.length);
      const chunks = Array.from(
        { length: Math.ceil(arranged.length / chunkSize) },
        (_, index) => arranged.slice(index * chunkSize, (index + 1) * chunkSize),
      );
      return [
        ...chunks.flatMap((chunk, index) => [
          ...chunk,
          ...(sameName[index] ? [sameName[index]] : []),
        ]),
        ...sameName.slice(chunks.length),
      ];
    },
    [...first],
  );
}

export function groupifierOrder(
  competition: Competition,
  roundId: string,
  people: readonly SchedulablePerson[],
  sortingRule: CompetitorSortingRule,
  groupCount: number,
): SchedulablePerson[] {
  const ranked = rankedEntrants(competition, roundId, people);
  const { eventId, roundNumber } = parseRoundId(roundId);
  if (roundNumber !== 1 || sortingRule === 'ranks') return ranked;
  if (sortingRule === 'balanced' && BALANCED_BY_RANKING.has(eventId)) return ranked;
  if (sortingRule === 'balanced' || sortingRule === 'symmetric') {
    return symmetricallyOrdered(ranked, groupCount);
  }
  return nameOptimised(ranked);
}

function intersection(first: Activity, second: Activity): number {
  if (!activitiesOverlap(first, second)) return 0;
  return (
    Math.min(Date.parse(first.endTime), Date.parse(second.endTime)) -
    Math.max(Date.parse(first.startTime), Date.parse(second.startTime))
  );
}

function assignedActivity(competition: Competition, activityId: number): Activity {
  const activity = findActivity(competition, activityId)?.activity;
  if (!activity) throw new Error(`Assignment refers to missing activity ${activityId}.`);
  return activity;
}

function availability(
  competition: Competition,
  activity: Activity,
  person: SchedulablePerson,
): number {
  const busy = (person.assignments ?? []).reduce(
    (total, assignment) =>
      total +
      intersection(assignedActivity(competition, assignment.activityId), activity),
    0,
  );
  return -busy / (Date.parse(activity.endTime) - Date.parse(activity.startTime));
}

function normalizedRoles(person: Person): Set<string> {
  return new Set(
    (person.roles ?? []).map((role) => (role === 'trainee-delegate' ? 'delegate' : role)),
  );
}

function preservesRoleCoverage(
  competition: Competition,
  groups: readonly PlannedGroup[],
  activity: Activity,
  person: SchedulablePerson,
): boolean {
  const roles = normalizedRoles(person);
  for (const role of COVERAGE_ROLES) {
    if (!roles.has(role)) continue;
    const others = competition.persons.filter(
      (other): other is SchedulablePerson =>
        Number.isSafeInteger(other.registrantId) &&
        other.registration?.status === 'accepted' &&
        other.wcaUserId !== person.wcaUserId &&
        normalizedRoles(other).has(role),
    );
    if (
      others.length > 0 &&
      others.every(
        (other) =>
          (other.assignments ?? []).some((assignment) =>
            activitiesOverlap(
              assignedActivity(competition, assignment.activityId),
              activity,
            ),
          ) ||
          groups.some(
            (group) =>
              group.members.includes(other) &&
              activitiesOverlap(group.activity, activity),
          ),
      )
    )
      return false;
  }
  return true;
}

function move(
  groups: readonly PlannedGroup[],
  from: number,
  to: number,
  person: SchedulablePerson,
  atStart: boolean,
): void {
  const source = groups[from];
  const target = groups[to];
  if (!source || !target) return;
  source.members.splice(source.members.indexOf(person), 1);
  if (atStart) target.members.unshift(person);
  else target.members.push(person);
}

function moveRight(
  competition: Competition,
  groups: readonly PlannedGroup[],
  sourceIndex: number,
): boolean {
  const source = groups[sourceIndex];
  if (!source) return false;
  for (let targetIndex = sourceIndex + 1; targetIndex < groups.length; targetIndex += 1) {
    const target = groups[targetIndex];
    if (!target) continue;
    const candidate = [...source.members]
      .reverse()
      .find(
        (person) =>
          availability(competition, source.activity, person) ===
            availability(competition, target.activity, person) &&
          preservesRoleCoverage(competition, groups, target.activity, person),
      );
    if (!candidate) continue;
    if (
      target.members.length < target.size ||
      (target.members.length === target.size &&
        moveRight(competition, groups, targetIndex))
    ) {
      move(groups, sourceIndex, targetIndex, candidate, true);
      return true;
    }
  }
  return false;
}

function moveLeft(
  competition: Competition,
  groups: readonly PlannedGroup[],
  sourceIndex: number,
): boolean {
  const source = groups[sourceIndex];
  if (!source) return false;
  for (let targetIndex = sourceIndex - 1; targetIndex >= 0; targetIndex -= 1) {
    const target = groups[targetIndex];
    if (!target) continue;
    const candidate = source.members.find(
      (person) =>
        availability(competition, source.activity, person) ===
          availability(competition, target.activity, person) &&
        preservesRoleCoverage(competition, groups, target.activity, person),
    );
    if (candidate && moveRight(competition, groups, targetIndex)) {
      move(groups, sourceIndex, targetIndex, candidate, false);
      return true;
    }
  }
  return false;
}

function groupSizes(capacities: readonly number[], people: number): number[] {
  const sizes: number[] = [];
  let remainingPeople = people;
  let remainingCapacity = capacities.reduce((sum, capacity) => sum + capacity, 0);
  for (const [index, capacity] of capacities.entries()) {
    const size =
      index === capacities.length - 1
        ? remainingPeople
        : Math.round((capacity / remainingCapacity) * remainingPeople);
    sizes.push(size);
    remainingPeople -= size;
    remainingCapacity -= capacity;
  }
  return sizes;
}

export function groupifierStrategy(
  roundId: string,
  sortingRule: CompetitorSortingRule,
  capacityByActivityId: ReadonlyMap<number, number>,
): GroupAssignmentStrategy {
  return {
    solve(problem) {
      const orderedGroups = [...problem.groups].sort((first, second) => {
        const firstNumber = groupNumber(first) ?? 0;
        const secondNumber = groupNumber(second) ?? 0;
        return firstNumber - secondNumber;
      });
      const capacities = orderedGroups.map((group) => {
        const parent = findActivity(problem.competition, group.id)?.parent;
        if (!parent) throw new Error(`${group.activityCode} has no parent activity.`);
        const capacity = capacityByActivityId.get(parent.id);
        if (capacity === undefined || capacity <= 0) {
          throw new Error(`Activity ${parent.id} needs a positive capacity.`);
        }
        return capacity / (parent.childActivities?.length ?? 1);
      });
      const sizes = groupSizes(capacities, problem.people.length);
      const groups = orderedGroups.map(
        (activity, index): PlannedGroup => ({
          activity,
          size: sizes[index] ?? 0,
          members: [],
        }),
      );
      const people = groupifierOrder(
        problem.competition,
        roundId,
        problem.people,
        sortingRule,
        groups.length,
      );
      for (const person of people) {
        const rates = groups.map((group) =>
          availability(problem.competition, group.activity, person),
        );
        const bestRate = Math.max(...rates);
        const mostAvailable = groups.filter((_, index) => rates[index] === bestRate);
        const preferred = mostAvailable.filter((group) =>
          preservesRoleCoverage(problem.competition, groups, group.activity, person),
        );
        const candidates = preferred.length > 0 ? preferred : mostAvailable;
        const target =
          candidates.find((group) => group.members.length < group.size) ??
          candidates.at(-1);
        if (!target) throw new Error(`No group is available for ${person.name}.`);
        target.members.push(person);
        if (target.members.length > target.size) {
          const targetIndex = groups.indexOf(target);
          moveRight(problem.competition, groups, targetIndex) ||
            moveLeft(problem.competition, groups, targetIndex);
        }
      }
      return new Map(groups.map((group) => [group.activity, group.members]));
    },
  };
}

export function stationOrder(
  competition: Competition,
  roundId: string,
  people: readonly SchedulablePerson[],
): (person: SchedulablePerson) => number {
  const ranked = rankedEntrants(competition, roundId, people).reverse();
  const rank = new Map(ranked.map((person, index) => [person.registrantId, index]));
  return (person) => rank.get(person.registrantId) ?? ranked.length;
}
