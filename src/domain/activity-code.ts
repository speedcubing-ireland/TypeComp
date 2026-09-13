export interface ParsedActivityCode {
  readonly eventId: string;
  readonly roundNumber: number;
  readonly groupNumber: number | null;
  readonly attemptNumber: number | null;
}

const ACTIVITY_CODE = /^([a-z0-9]+)-r([1-9]\d*)(?:-g([1-9]\d*))?(?:-a([1-9]\d*))?$/;

export function parseActivityCode(code: string): ParsedActivityCode | null {
  const match = ACTIVITY_CODE.exec(code);
  if (!match?.[1] || !match[2]) return null;

  return {
    eventId: match[1],
    roundNumber: Number(match[2]),
    groupNumber: match[3] ? Number(match[3]) : null,
    attemptNumber: match[4] ? Number(match[4]) : null,
  };
}

export function parseRoundId(roundId: string): ParsedActivityCode {
  const parsed = parseActivityCode(roundId);
  if (!parsed || parsed.groupNumber !== null || parsed.attemptNumber !== null) {
    throw new TypeError(`Invalid round id: ${roundId}`);
  }
  return parsed;
}

export function groupCode(roundId: string, groupNumber: number): string {
  parseRoundId(roundId);
  if (!Number.isSafeInteger(groupNumber) || groupNumber < 1) {
    throw new RangeError('Group number must be a positive integer.');
  }
  return `${roundId}-g${groupNumber}`;
}

export function groupNumber(activity: { readonly activityCode: string }): number | null {
  return parseActivityCode(activity.activityCode)?.groupNumber ?? null;
}

export function roundIdFor(activity: { readonly activityCode: string }): string | null {
  const parsed = parseActivityCode(activity.activityCode);
  return parsed ? `${parsed.eventId}-r${parsed.roundNumber}` : null;
}
