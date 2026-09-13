import type {
  GroupConstraint,
  GroupPredicate,
  PersonPredicate,
  StaffConstraint,
} from './domain/types';

export function groupConstraint(
  name: string,
  allows: GroupConstraint['allows'],
): GroupConstraint {
  return { name, allows };
}

export function requireGroups(
  name: string,
  people: PersonPredicate,
  groups: GroupPredicate,
): GroupConstraint {
  return groupConstraint(name, (person, group) => !people(person) || groups(group));
}

export function excludeGroups(
  name: string,
  people: PersonPredicate,
  groups: GroupPredicate,
): GroupConstraint {
  return groupConstraint(name, (person, group) => !people(person) || !groups(group));
}

export function staffConstraint(
  name: string,
  allows: StaffConstraint['allows'],
): StaffConstraint {
  return { name, allows };
}
