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

export async function planLaterRound(
  session: CompetitionSession,
  roundId: string,
  groupCount: number,
): Promise<AssignmentSummary> {
  const { eventId } = parseRoundId(roundId);
  const round = session.round(roundId);
  round.createGroups({ count: groupCount });
  return round.assignCompetitors({
    stationOrder: (person) => personalBest(person, eventId) ?? Infinity,
    seed: `${roundId}:live-results`,
  });
}

if (import.meta.main) {
  const competitionId = requiredArgument(0, 'competition id');
  const roundId = optionalArgument(1, '333-r2');
  const groupCount = positiveIntegerArgument(2, 2);
  const session = await loadSession(competitionId);
  const result = await planLaterRound(session, roundId, groupCount);
  console.log(result);
  await finish(session);
}
