import { shuffled } from '../domain/random';
import type {
  Activity,
  Competition,
  GroupConstraint,
  GroupPreference,
  SchedulablePerson,
} from '../domain/types';
import { PlanningError } from '../errors';
import { balancedCapacities, solveMatching } from './matching';

export interface GroupAssignmentProblem {
  readonly competition: Competition;
  readonly people: readonly SchedulablePerson[];
  readonly groups: readonly Activity[];
  readonly constraints: readonly GroupConstraint[];
  readonly preferences: readonly GroupPreference[];
  readonly maxGroupSize?: number;
  readonly seed: string | number;
  readonly improvementPasses: number;
}

export type GroupAllocation = ReadonlyMap<Activity, readonly SchedulablePerson[]>;

export interface GroupAssignmentStrategy {
  solve(problem: GroupAssignmentProblem): GroupAllocation | Promise<GroupAllocation>;
}

type MutableAllocation = Map<Activity, SchedulablePerson[]>;

function preferenceScore(
  problem: GroupAssignmentProblem,
  person: SchedulablePerson,
  group: Activity,
  members: readonly SchedulablePerson[],
): number {
  return problem.preferences.reduce((total, preference) => {
    const score = preference.score(person, {
      competition: problem.competition,
      group,
      members,
    });
    const weighted = score * preference.weight;
    if (!Number.isFinite(weighted)) {
      throw new PlanningError(
        `Preference "${preference.name}" returned a non-finite score.`,
      );
    }
    const next = total + weighted;
    if (!Number.isFinite(next)) {
      throw new PlanningError('The combined preference score is non-finite.');
    }
    return next;
  }, 0);
}

function groupScore(
  problem: GroupAssignmentProblem,
  group: Activity,
  members: readonly SchedulablePerson[],
): number {
  return members.reduce(
    (total, person) =>
      total +
      preferenceScore(
        problem,
        person,
        group,
        members.filter((member) => member !== person),
      ),
    0,
  );
}

function trySwap(
  problem: GroupAssignmentProblem,
  allocation: MutableAllocation,
  firstGroup: Activity,
  firstPerson: SchedulablePerson,
  secondGroup: Activity,
  secondPerson: SchedulablePerson,
): boolean {
  const swapAllowed =
    problem.constraints.every((rule) =>
      rule.allows(firstPerson, secondGroup, problem.competition),
    ) &&
    problem.constraints.every((rule) =>
      rule.allows(secondPerson, firstGroup, problem.competition),
    );
  if (!swapAllowed) return false;

  const firstMembers = allocation.get(firstGroup) ?? [];
  const secondMembers = allocation.get(secondGroup) ?? [];
  const before =
    groupScore(problem, firstGroup, firstMembers) +
    groupScore(problem, secondGroup, secondMembers);
  const nextFirst = firstMembers.map((person) =>
    person === firstPerson ? secondPerson : person,
  );
  const nextSecond = secondMembers.map((person) =>
    person === secondPerson ? firstPerson : person,
  );
  const after =
    groupScore(problem, firstGroup, nextFirst) +
    groupScore(problem, secondGroup, nextSecond);
  if (after <= before) return false;
  allocation.set(firstGroup, nextFirst);
  allocation.set(secondGroup, nextSecond);
  return true;
}

function improvePair(
  problem: GroupAssignmentProblem,
  allocation: MutableAllocation,
  firstGroup: Activity,
  secondGroup: Activity,
): boolean {
  for (const firstPerson of allocation.get(firstGroup) ?? []) {
    for (const secondPerson of allocation.get(secondGroup) ?? []) {
      if (
        trySwap(problem, allocation, firstGroup, firstPerson, secondGroup, secondPerson)
      ) {
        return true;
      }
    }
  }
  return false;
}

function improvementPass(
  problem: GroupAssignmentProblem,
  allocation: MutableAllocation,
): boolean {
  const groups = [...allocation.keys()];
  let changed = false;
  for (let first = 0; first < groups.length; first += 1) {
    for (let second = first + 1; second < groups.length; second += 1) {
      const firstGroup = groups[first];
      const secondGroup = groups[second];
      if (
        firstGroup &&
        secondGroup &&
        improvePair(problem, allocation, firstGroup, secondGroup)
      ) {
        changed = true;
      }
    }
  }
  return changed;
}

function improve(problem: GroupAssignmentProblem, allocation: MutableAllocation): void {
  for (
    let pass = 0;
    pass < problem.improvementPasses && problem.preferences.length > 0;
    pass += 1
  ) {
    if (!improvementPass(problem, allocation)) return;
  }
}

export const balancedMatchingStrategy: GroupAssignmentStrategy = {
  solve(problem) {
    if (
      !Number.isSafeInteger(problem.improvementPasses) ||
      problem.improvementPasses < 0
    ) {
      throw new PlanningError('Improvement passes must be a non-negative integer.');
    }
    const people = shuffled(problem.people, problem.seed);
    const groups = shuffled(problem.groups, problem.seed);
    const initial = solveMatching<SchedulablePerson, Activity>({
      items: people,
      bins: groups,
      capacities: balancedCapacities(people.length, groups.length, problem.maxGroupSize),
      constraints: problem.constraints.map((constraint) => ({
        name: constraint.name,
        allows: (person, group) => constraint.allows(person, group, problem.competition),
      })),
      describeItem: (person) => `${person.name} (#${person.registrantId})`,
    });
    const allocation: MutableAllocation = new Map(
      groups.map((group) => [
        group,
        people.filter((person) => initial.get(person) === group),
      ]),
    );
    improve(problem, allocation);
    return allocation;
  },
};
