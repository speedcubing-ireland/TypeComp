import type {
  Activity,
  RegistrantId,
  Competition as WcaCompetition,
  Person as WcaPerson,
} from '@wca/helpers';

export type {
  Activity,
  Assignment,
  Event,
  RegistrantId,
  Room,
  Round,
  Venue,
} from '@wca/helpers';

export interface Person extends Omit<WcaPerson, 'registrantId'> {
  registrantId: RegistrantId | null;
}

export interface Competition extends Omit<WcaCompetition, 'persons'> {
  persons: Person[];
}

export type SchedulablePerson = Person & { registrantId: RegistrantId };
export type PersonPredicate = (person: Person) => boolean;
export type GroupPredicate = (group: Activity) => boolean;

export interface GroupScoreContext {
  readonly competition: Competition;
  readonly group: Activity;
  readonly members: readonly SchedulablePerson[];
}

export type GroupScorer = (
  person: SchedulablePerson,
  context: GroupScoreContext,
) => number;

export interface GroupConstraint {
  readonly name: string;
  allows(person: SchedulablePerson, group: Activity, competition: Competition): boolean;
}

export interface GroupPreference {
  readonly name: string;
  readonly weight: number;
  score(person: SchedulablePerson, context: GroupScoreContext): number;
}

export interface StaffScoreContext {
  readonly competition: Competition;
  readonly activity: Activity;
  readonly assignmentCode: string;
  readonly stationNumber: number | null;
  readonly assignmentCount: number;
}

export type StaffScorer = (person: Person, context: StaffScoreContext) => number;

export interface StaffConstraint {
  readonly name: string;
  allows(
    person: Person,
    activity: Activity,
    assignmentCode: string,
    competition: Competition,
  ): boolean;
}

export interface StaffRole {
  readonly assignmentCode: `staff-${string}`;
  readonly count: number;
  readonly stations?: boolean;
  readonly eligible?: PersonPredicate;
}

export interface AssignmentSummary {
  readonly assigned: number;
  readonly activities: number;
}

export type WritableSection = 'events' | 'persons' | 'schedule';

export interface CompetitionTransport {
  fetchCompetition(competitionId: string): Promise<Competition>;
  publishCompetition(
    competitionId: string,
    patch: Partial<Pick<Competition, WritableSection>>,
  ): Promise<Competition>;
}
