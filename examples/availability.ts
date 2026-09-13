import {
  type AssignmentSummary,
  type CompetitionSession,
  parseRoundId,
  personalBest,
} from '@speedcubingireland/typecomp';
import {
  finish,
  loadSession,
  optionalArgument,
  positiveIntegerArgument,
  requiredArgument,
} from './support';

export async function planAroundExistingAssignments(
  session: CompetitionSession,
  roundId: string,
  groupCount: number,
): Promise<AssignmentSummary> {
  const { eventId } = parseRoundId(roundId);
  const round = session.round(roundId);
  round.createGroups({ count: groupCount });
  return round.assignCompetitors({
    stationOrder: (person) => personalBest(person, eventId) ?? Infinity,
    seed: `${roundId}:availability`,
  });
}

if (import.meta.main) {
  const competitionId = requiredArgument(0, 'competition id');
  const roundId = optionalArgument(1, '333-r1');
  const groupCount = positiveIntegerArgument(2, 3);
  const session = await loadSession(competitionId);
  const result = await planAroundExistingAssignments(session, roundId, groupCount);
  console.log(result);
  await finish(session);
}
