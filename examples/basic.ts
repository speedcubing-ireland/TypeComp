import {
  type AssignmentSummary,
  assignmentsForActivity,
  type CompetitionSession,
  differentFirstNames,
  hasPersonalBest,
  parseRoundId,
  personalBest,
  preferFaster,
  sameCountry,
} from '@speedcubingireland/typecomp';
import {
  finish,
  loadSession,
  optionalArgument,
  positiveIntegerArgument,
  requiredArgument,
} from './support';

export interface BasicPlanResult {
  readonly competitors: AssignmentSummary;
  readonly staff: AssignmentSummary;
}

export async function planBasicRound(
  session: CompetitionSession,
  roundId: string,
  groupCount: number,
): Promise<BasicPlanResult> {
  const { eventId } = parseRoundId(roundId);
  const round = session.round(roundId);
  round.createGroups({ count: groupCount });
  const competitors = await round.assignCompetitors({
    maxGroupSize: 25,
    preferences: [sameCountry(2), differentFirstNames(5)],
    stationOrder: (person) => personalBest(person, eventId) ?? Infinity,
    seed: `${roundId}:competitors`,
  });
  const staff = round.assignStaff({
    roles: [
      { assignmentCode: 'staff-judge', count: 1, stations: true },
      {
        assignmentCode: 'staff-scrambler',
        count: 1,
        eligible: hasPersonalBest(eventId),
      },
      { assignmentCode: 'staff-runner', count: 1 },
    ],
    preferences: [preferFaster(eventId)],
    seed: `${roundId}:staff`,
  });
  round.setScrambleSetCountFromGroups();
  return { competitors, staff };
}

export function printRound(session: CompetitionSession, roundId: string): void {
  const competition = session.competition;
  for (const group of session.round(roundId).groups()) {
    const assignments = assignmentsForActivity(competition, group.id);
    const competitors = assignments.filter(
      ({ assignment }) => assignment.assignmentCode === 'competitor',
    ).length;
    const staff = assignments.filter(({ assignment }) =>
      assignment.assignmentCode.startsWith('staff-'),
    ).length;
    console.log(`${group.activityCode}: ${competitors} competitors, ${staff} staff`);
  }
}

if (import.meta.main) {
  const competitionId = requiredArgument(0, 'competition id');
  const roundId = optionalArgument(1, '333-r1');
  const groupCount = positiveIntegerArgument(2, 4);
  const session = await loadSession(competitionId);
  const result = await planBasicRound(session, roundId, groupCount);
  console.log(result);
  printRound(session, roundId);
  await finish(session);
}
