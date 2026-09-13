import {
  type AssignmentSummary,
  type CompetitionSession,
  groupNumber,
  parseRoundId,
  preference,
  registeredFor,
  schedulablePeople,
} from '@speedcubingireland/typecomp';
import {
  finish,
  loadSession,
  optionalArgument,
  positiveIntegerArgument,
  requiredArgument,
} from './support';

export async function planByAge(
  session: CompetitionSession,
  roundId: string,
  groupCount: number,
): Promise<AssignmentSummary> {
  const { eventId } = parseRoundId(roundId);
  const people = schedulablePeople(session.competition)
    .filter(registeredFor(eventId))
    .filter((person) => person.birthdate)
    .sort((first, second) => {
      const firstDate = first.birthdate ?? '';
      const secondDate = second.birthdate ?? '';
      return firstDate < secondDate ? 1 : firstDate > secondDate ? -1 : 0;
    });
  const ageRank = new Map(
    people.map((person, index) => [person.registrantId, index / people.length]),
  );
  const round = session.round(roundId);
  round.createGroups({ count: groupCount });
  return round.assignCompetitors({
    preferences: [
      preference(
        'similar ages',
        (person, { group }) => {
          const rank = ageRank.get(person.registrantId);
          if (rank === undefined) return 0;
          const target = Math.min(Math.floor(rank * groupCount) + 1, groupCount);
          return groupNumber(group) === target ? 1 : 0;
        },
        100,
      ),
      preference(
        'different birthdays',
        (person, { members }) => {
          if (!person.birthdate) return 0;
          return members.some((member) => member.birthdate === person.birthdate) ? -1 : 0;
        },
        1_000,
      ),
    ],
    stationOrder: (person) => Date.parse(person.birthdate ?? '1900-01-01'),
    stationDirection: 'descending',
    seed: `${roundId}:ages`,
  });
}

if (import.meta.main) {
  const competitionId = requiredArgument(0, 'competition id');
  const roundId = optionalArgument(1, '333-r1');
  const groupCount = positiveIntegerArgument(2, 4);
  const session = await loadSession(competitionId);
  await planByAge(session, roundId, groupCount);
  await finish(session);
}
