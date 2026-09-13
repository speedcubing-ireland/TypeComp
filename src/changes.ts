import { activities, assignmentsOf, personKey, stableJson } from './domain/competition';
import type { Competition, WritableSection } from './domain/types';

export interface CountedChanges {
  readonly added: number;
  readonly removed: number;
  readonly updated: number;
}

export interface ChangeSummary {
  readonly sections: ReadonlySet<WritableSection>;
  readonly activities: CountedChanges;
  readonly assignments: Omit<CountedChanges, 'updated'>;
  readonly scrambleSetCounts: number;
}

function differenceSize(first: ReadonlySet<string>, second: ReadonlySet<string>): number {
  let count = 0;
  for (const value of first) if (!second.has(value)) count += 1;
  return count;
}

function assignmentKeys(competition: Competition): Set<string> {
  return new Set(
    competition.persons.flatMap((person) =>
      assignmentsOf(person).map((assignment) =>
        stableJson({ person: personKey(person), ...assignment }),
      ),
    ),
  );
}

function activityStates(competition: Competition): ReadonlyMap<number, string> {
  return new Map(
    activities(competition).map(({ activity }) => [
      activity.id,
      stableJson({
        activityCode: activity.activityCode,
        name: activity.name,
        startTime: activity.startTime,
        endTime: activity.endTime,
        scrambleSetId: activity.scrambleSetId ?? null,
        extensions: activity.extensions,
      }),
    ]),
  );
}

function activityChanges(baseline: Competition, working: Competition): CountedChanges {
  const before = activityStates(baseline);
  const after = activityStates(working);
  let updated = 0;
  for (const [id, state] of before) {
    if (after.has(id) && after.get(id) !== state) updated += 1;
  }
  return {
    added: [...after.keys()].filter((id) => !before.has(id)).length,
    removed: [...before.keys()].filter((id) => !after.has(id)).length,
    updated,
  };
}

function scrambleSetChanges(baseline: Competition, working: Competition): number {
  const before = new Map(
    baseline.events.flatMap((event) =>
      event.rounds.map((round) => [round.id, round.scrambleSetCount ?? null] as const),
    ),
  );
  return working.events.reduce(
    (count, event) =>
      count +
      event.rounds.filter(
        (round) => before.get(round.id) !== (round.scrambleSetCount ?? null),
      ).length,
    0,
  );
}

export function summarizeChanges(
  baseline: Competition,
  working: Competition,
  sections: ReadonlySet<WritableSection>,
): ChangeSummary {
  const beforeAssignments = assignmentKeys(baseline);
  const afterAssignments = assignmentKeys(working);
  return {
    sections: new Set(sections),
    activities: activityChanges(baseline, working),
    assignments: {
      added: differenceSize(afterAssignments, beforeAssignments),
      removed: differenceSize(beforeAssignments, afterAssignments),
    },
    scrambleSetCounts: scrambleSetChanges(baseline, working),
  };
}
