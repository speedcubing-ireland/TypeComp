export type { ChangeSummary, CountedChanges } from './changes';
export {
  excludeGroups,
  groupConstraint,
  requireGroups,
  staffConstraint,
} from './constraints';
export {
  groupCode,
  groupNumber,
  type ParsedActivityCode,
  parseActivityCode,
  parseRoundId,
  roundIdFor,
} from './domain/activity-code';
export type { LocatedActivity, LocatedAssignment } from './domain/competition';
export {
  activities,
  assignmentsForActivity,
  findActivity,
  findRound,
  groupsForRound,
  personById,
  roundEntrants,
  schedulablePeople,
} from './domain/competition';
export { overlaps as activitiesOverlap } from './domain/time';
export type {
  Activity,
  Assignment,
  AssignmentSummary,
  Competition,
  CompetitionTransport,
  Event,
  GroupConstraint,
  GroupPredicate,
  GroupPreference,
  GroupScoreContext,
  Person,
  PersonPredicate,
  RegistrantId,
  Room,
  Round,
  SchedulablePerson,
  StaffConstraint,
  StaffRole,
  StaffScoreContext,
  StaffScorer,
  Venue,
  WritableSection,
} from './domain/types';
export {
  InfeasibleAssignmentError,
  PlanningError,
  PublishConflictError,
  TypeCompError,
  WcaApiError,
} from './errors';
export {
  accepted,
  and,
  everyGroup,
  everyone,
  fromCountry,
  group,
  hasPersonalBest,
  hasRole,
  namedGroup,
  not,
  or,
  registeredFor,
} from './filters';
export { ActivityPlan } from './planning/activity';
export type { AssignCompetitorsOptions } from './planning/competitors';
export type {
  CreatedGroups,
  CreatedRoundGroups,
  CreateGroupsAcrossOptions,
  CreateGroupsOptions,
  GroupBlock,
} from './planning/groups';
export type {
  AssignParallelRoundsOptions,
  ParallelAssignmentSummary,
} from './planning/parallel';
export { RoundPlan } from './planning/round';
export type { AssignStaffOptions } from './planning/staff';
export {
  differentFirstNames,
  matching,
  personalBest,
  preference,
  preferFaster,
  preferRole,
  sameCountry,
} from './scorers';
export { CompetitionSession } from './session';
export {
  balancedMatchingStrategy,
  type GroupAllocation,
  type GroupAssignmentProblem,
  type GroupAssignmentStrategy,
} from './solver/group-strategy';
export {
  assertValidCompetition,
  type ValidationIssue,
  validateCompetition,
} from './validation';
export { type Fetch, WcaClient, type WcaClientOptions } from './wca-client';
