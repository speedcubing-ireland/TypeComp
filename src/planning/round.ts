import {
  cloneCompetition,
  copyAssignments,
  findRound,
  groupsForRound,
} from '../domain/competition';
import type { Activity, Competition } from '../domain/types';
import { type AssignCompetitorsOptions, assignCompetitors } from './competitors';
import {
  type CreateGroupsAcrossOptions,
  type CreateGroupsOptions,
  createGroups,
  createGroupsAcrossActivities,
} from './groups';
import { type AssignStaffOptions, assignStaff } from './staff';

export class RoundPlan {
  constructor(
    private readonly currentCompetition: () => Competition,
    readonly roundId: string,
  ) {
    findRound(currentCompetition(), roundId);
  }

  createGroups(options: CreateGroupsOptions) {
    return createGroups(this.currentCompetition(), this.roundId, options);
  }

  createGroupsAcrossActivities(options: CreateGroupsAcrossOptions) {
    return createGroupsAcrossActivities(this.currentCompetition(), this.roundId, options);
  }

  groups(): readonly Activity[] {
    return structuredClone(groupsForRound(this.currentCompetition(), this.roundId));
  }

  async assignCompetitors(options: AssignCompetitorsOptions = {}) {
    const competition = this.currentCompetition();
    const draft = cloneCompetition(competition);
    const result = await assignCompetitors(draft, this.roundId, options);
    copyAssignments(competition, draft);
    return result;
  }

  assignStaff(options: AssignStaffOptions) {
    const competition = this.currentCompetition();
    const draft = cloneCompetition(competition);
    const result = assignStaff(draft, this.roundId, options);
    copyAssignments(competition, draft);
    return result;
  }

  setScrambleSetCount(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RangeError('Scramble set count must be a positive integer.');
    }
    findRound(this.currentCompetition(), this.roundId).scrambleSetCount = count;
  }

  setScrambleSetCountFromGroups(): void {
    const count = new Set(
      groupsForRound(this.currentCompetition(), this.roundId).map(
        (group) => `${group.startTime}/${group.endTime}`,
      ),
    ).size;
    if (count === 0) throw new RangeError(`${this.roundId} has no groups.`);
    this.setScrambleSetCount(count);
  }
}
