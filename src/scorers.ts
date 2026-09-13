import type {
  GroupPreference,
  GroupScorer,
  Person,
  SchedulablePerson,
  StaffScorer,
} from './domain/types';

function firstName(person: Person): string {
  return person.name.trim().split(/\s+/u)[0]?.toLowerCase() ?? '';
}

export function personalBest(
  person: Person,
  eventId: string,
  type: 'average' | 'single' = 'average',
): number | null {
  return (
    person.personalBests?.find((best) => best.eventId === eventId && best.type === type)
      ?.best ?? null
  );
}

export function preference(
  name: string,
  score: GroupScorer,
  weight = 1,
): GroupPreference {
  return { name, score, weight };
}

export function sameCountry(weight = 1): GroupPreference {
  return preference(
    'same country',
    (person, { members }) =>
      members.filter((member) => member.countryIso2 === person.countryIso2).length,
    weight,
  );
}

export function differentFirstNames(weight = 1): GroupPreference {
  return preference(
    'different first names',
    (person, { members }) =>
      members.some((member) => firstName(member) === firstName(person)) ? -1 : 0,
    Math.abs(weight),
  );
}

export function matching<T>(
  select: (person: SchedulablePerson) => T,
  weight = 1,
): GroupPreference {
  return preference(
    'matching value',
    (person, { members }) =>
      members.filter((member) => Object.is(select(member), select(person))).length,
    weight,
  );
}

export function preferFaster(
  eventId: string,
  type: 'average' | 'single' = 'average',
  weight = 1,
): StaffScorer {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new RangeError(
      'Faster preference weight must be a non-negative finite number.',
    );
  }
  return (person) => {
    const result = personalBest(person, eventId, type);
    return result === null ? -Number.MAX_SAFE_INTEGER * weight : -result * weight;
  };
}

export function preferRole(role: string, weight = 100): StaffScorer {
  return (person) => (person.roles?.some((candidate) => candidate === role) ? weight : 0);
}
