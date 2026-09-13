import { CompetitionSession, WcaClient } from '@speedcubingireland/typecomp';

function positionalArguments(): string[] {
  return Bun.argv.slice(2).filter((argument) => !argument.startsWith('--'));
}

export function requiredArgument(index: number, name: string): string {
  const value = positionalArguments()[index];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function optionalArgument(index: number, fallback: string): string {
  return positionalArguments()[index] ?? fallback;
}

export function positiveIntegerArgument(index: number, fallback: number): number {
  const value = Number(positionalArguments()[index] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Argument ${index + 1} must be a positive integer.`);
  }
  return value;
}

export function publishRequested(): boolean {
  return Bun.argv.includes('--publish');
}

export async function loadSession(competitionId: string): Promise<CompetitionSession> {
  const accessToken = Bun.env.WCA_ACCESS_TOKEN;
  if (publishRequested() && !accessToken) {
    throw new Error('WCA_ACCESS_TOKEN is required with --publish.');
  }
  const client = new WcaClient(accessToken ? { accessToken } : {});
  return CompetitionSession.load(client, competitionId);
}

export async function finish(session: CompetitionSession): Promise<void> {
  const issues = session.validate();
  if (issues.length > 0) console.table(issues);
  if (issues.some((issue) => issue.severity === 'error')) {
    throw new Error('The planned WCIF contains validation errors.');
  }
  console.log(session.changes());
  if (!publishRequested()) {
    console.log('Dry run complete. Pass --publish to update the WCA website.');
    return;
  }
  await session.publish();
  console.log('Published successfully.');
}
