export class TypeCompError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = 'TypeCompError';
  }
}

export class PlanningError extends TypeCompError {
  constructor(
    message: string,
    details: Readonly<Record<string, string | number>> = {},
    code = 'PLANNING_FAILED',
  ) {
    super(message, code, details);
    this.name = 'PlanningError';
  }
}

export class InfeasibleAssignmentError extends PlanningError {
  constructor(message: string, details?: Readonly<Record<string, string | number>>) {
    super(message, details, 'INFEASIBLE_ASSIGNMENT');
    this.name = 'InfeasibleAssignmentError';
  }
}

export class PublishConflictError extends TypeCompError {
  constructor(section: string) {
    super(
      `The remote ${section} changed after this session was loaded. Refresh and plan again.`,
      'PUBLISH_CONFLICT',
      { section },
    );
    this.name = 'PublishConflictError';
  }
}

export class WcaApiError extends TypeCompError {
  constructor(message: string, status: number) {
    super(message, 'WCA_API_ERROR', { status });
    this.name = 'WcaApiError';
  }
}
