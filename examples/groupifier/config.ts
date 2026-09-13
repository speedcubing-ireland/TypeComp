export type CompetitorSortingRule = 'ranks' | 'balanced' | 'symmetric' | 'name-optimised';

export interface AssignmentOptions {
  readonly competitorSortingRule: CompetitorSortingRule;
  readonly noTasksForNewcomers: boolean;
  readonly tasksForOwnEventsOnly: boolean;
  readonly noRunningForForeigners: boolean;
  readonly printStations: boolean;
}

export interface RoomOptions {
  readonly room: string;
  readonly stations: number;
}

export type RoundActivityTarget =
  | { readonly room: string }
  | { readonly activityId: number };

export interface RoundActivityOptions {
  readonly target: RoundActivityTarget;
  readonly capacity: number;
  readonly groups: number;
  readonly scramblers: number;
  readonly runners: number;
  readonly assignJudges: boolean;
}

export interface RoundOptions {
  readonly roundId: string;
  readonly activities: readonly RoundActivityOptions[];
}

export interface GroupifierOptions {
  readonly assignments: AssignmentOptions;
  readonly rooms: readonly RoomOptions[];
  readonly rounds: readonly RoundOptions[];
}

export const GROUPIFIER_OPTIONS = {
  assignments: {
    competitorSortingRule: 'ranks',
    noTasksForNewcomers: false,
    tasksForOwnEventsOnly: false,
    noRunningForForeigners: false,
    printStations: true,
  },
  rooms: [{ room: 'Main Stage', stations: 16 }],
  rounds: [
    {
      roundId: '333-r1',
      activities: [
        {
          target: { room: 'Main Stage' },
          capacity: 1,
          groups: 4,
          scramblers: 3,
          runners: 2,
          assignJudges: true,
        },
      ],
    },
  ],
} as const satisfies GroupifierOptions;
