import { cloneCompetition, copyAssignments, findActivity } from '../domain/competition';
import type { Competition } from '../domain/types';
import { type AssignStaffOptions, assignStaffToActivity } from './staff';

export class ActivityPlan {
  constructor(
    private readonly currentCompetition: () => Competition,
    readonly activityId: number,
  ) {
    if (!findActivity(currentCompetition(), activityId)) {
      throw new RangeError(`Activity ${activityId} does not exist.`);
    }
  }

  assignStaff(options: Omit<AssignStaffOptions, 'groups'>) {
    const competition = this.currentCompetition();
    const draft = cloneCompetition(competition);
    const result = assignStaffToActivity(draft, this.activityId, options);
    copyAssignments(competition, draft);
    return result;
  }
}
