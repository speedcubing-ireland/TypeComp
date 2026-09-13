import { groupNumber } from './domain/activity-code';
import type { GroupPredicate, PersonPredicate } from './domain/types';

export const everyone: PersonPredicate = () => true;
export const everyGroup: GroupPredicate = () => true;

export function and<T>(...predicates: ReadonlyArray<(value: T) => boolean>) {
  return (value: T): boolean => predicates.every((predicate) => predicate(value));
}

export function or<T>(...predicates: ReadonlyArray<(value: T) => boolean>) {
  return (value: T): boolean => predicates.some((predicate) => predicate(value));
}

export function not<T>(predicate: (value: T) => boolean) {
  return (value: T): boolean => !predicate(value);
}

export const accepted: PersonPredicate = (person) =>
  person.registration?.status === 'accepted' && person.registration.isCompeting;

export function registeredFor(eventId: string): PersonPredicate {
  return (person) =>
    accepted(person) &&
    (person.registration?.eventIds.some((registered) => registered === eventId) ?? false);
}

export function fromCountry(countryIso2: string): PersonPredicate {
  const normalized = countryIso2.toUpperCase();
  return (person) => person.countryIso2.toUpperCase() === normalized;
}

export function hasRole(role: string): PersonPredicate {
  return (person) => person.roles?.some((candidate) => candidate === role) ?? false;
}

export function hasPersonalBest(
  eventId: string,
  type?: 'average' | 'single',
): PersonPredicate {
  return (person) =>
    person.personalBests?.some(
      (best) => best.eventId === eventId && (type === undefined || best.type === type),
    ) ?? false;
}

export function group(number: number): GroupPredicate {
  return (activity) => groupNumber(activity) === number;
}

export function namedGroup(name: string): GroupPredicate {
  const normalized = name.toLowerCase();
  return (activity) => activity.name.toLowerCase().includes(normalized);
}
