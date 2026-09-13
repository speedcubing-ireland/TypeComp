import type { Activity } from './types';

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

export function parseTimeRange(activity: Activity): TimeRange {
  const start = Date.parse(activity.startTime);
  const end = Date.parse(activity.endTime);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new TypeError(`Activity ${activity.id} has an invalid time range.`);
  }

  return { start, end };
}

export function overlaps(first: Activity, second: Activity): boolean {
  const a = parseTimeRange(first);
  const b = parseTimeRange(second);
  return a.start < b.end && b.start < a.end;
}
