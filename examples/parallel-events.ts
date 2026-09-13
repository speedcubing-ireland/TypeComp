import {
  type CompetitionSession,
  personalBest,
  sameCountry,
} from '@speedcubingireland/typecomp';
import {
  finish,
  loadSession,
  positiveIntegerArgument,
  requiredArgument,
} from './support';

export async function planParallelEvents(
  session: CompetitionSession,
  roundIds: readonly string[],
  groupCount: number,
) {
  return session.assignParallelRounds({
    roundIds,
    groupCount,
    maxWaveSize: 40,
    preferences: [sameCountry(1)],
    stationOrder: (person, eventId) =>
      personalBest(person, eventId, eventId.includes('bf') ? 'single' : 'average') ??
      Infinity,
    seed: `${roundIds.join(':')}:waves`,
  });
}

if (import.meta.main) {
  const competitionId = requiredArgument(0, 'competition id');
  const roundIds = requiredArgument(1, 'comma-separated round ids').split(',');
  const groupCount = positiveIntegerArgument(2, 3);
  const session = await loadSession(competitionId);
  const result = await planParallelEvents(session, roundIds, groupCount);
  console.log(result);
  await finish(session);
}
