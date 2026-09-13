# TypeComp

TypeComp plans competitor groups and staff assignments directly against WCIF. It is built for
repeatable scripts, current live results, and safe publishing—not a long-lived mirror of competition
state.

The library targets [WCIF 1.2](https://github.com/thewca/wcif/tree/stable) and the WCA's current
authorized/public WCIF endpoints. It runs on Bun 1.3.14+ and has no solver service, database, cache,
or framework dependency.

## Design

Assignments have two different kinds of rules:

- **Constraints** are absolute. A solution that violates one is rejected. Time conflicts, group
  capacity, role eligibility, and explicit placement rules belong here.
- **Preferences** improve a valid solution. Country clustering, name separation, speed, and workload
  distribution belong here. Preferences may compete, so their weights are meaningful.

The default competitor strategy first uses exact capacitated bipartite matching to find a complete,
balanced solution satisfying every hard constraint. It then improves group-composition preferences
with deterministic pair swaps. Staff activities are ordered by constraint scarcity, then the matching
engine fills each activity while respecting existing workload and cross-activity time conflicts.

Planning is atomic: if a complete solution cannot be found, the WCIF is unchanged. A seed makes the
result reproducible. `GroupAssignmentStrategy` is public, so unusually specialized competitions can
plug in CP-SAT or another optimizer without changing the WCIF or session layers.

WCIF people without a registration have a null registrant id. TypeComp preserves their assignments
and allows them to be selected for staff work; only competitor planning requires a registrant id.

## Install

```bash
bun add @speedcubingireland/typecomp
```

The package uses Bun's export condition and ships its TypeScript source directly.

For local development:

```bash
bun install
bun run check
```

## Example

```ts
import {
  CompetitionSession,
  WcaClient,
  accepted,
  differentFirstNames,
  group,
  personalBest,
  preferFaster,
  requireGroups,
  sameCountry,
} from '@speedcubingireland/typecomp';

const client = new WcaClient({
  accessToken: process.env.WCA_ACCESS_TOKEN,
});
const session = await CompetitionSession.load(client, 'ExampleOpen2027');
const round = session.round('333-r1');

round.createGroups({ count: 4 });

await round.assignCompetitors({
  maxGroupSize: 24,
  constraints: [
    requireGroups(
      'featured competitor starts in group one',
      (person) => person.wcaId === '2010EXAM01',
      group(1),
    ),
  ],
  preferences: [sameCountry(2), differentFirstNames(5)],
  stationOrder: (person) => personalBest(person, '333') ?? Infinity,
  seed: 'published-draw-v1',
});

round.assignStaff({
  select: accepted,
  roles: [
    { assignmentCode: 'staff-judge', count: 12, stations: true },
    {
      assignmentCode: 'staff-scrambler',
      count: 3,
      eligible: (person) => personalBest(person, '333') !== null,
    },
    { assignmentCode: 'staff-runner', count: 2 },
  ],
  preferences: [preferFaster('333')],
  seed: 'published-staff-v1',
});

round.setScrambleSetCountFromGroups();

const errors = session.validate().filter((issue) => issue.severity === 'error');
if (errors.length > 0) throw new Error(JSON.stringify(errors, null, 2));

console.table(session.changes());
await session.publish();
```

## Runnable examples

The examples import the package by name and are typechecked and executed by the test suite. They
fetch current WCIF data and stop after printing the planned changes unless `--publish` is explicitly
passed. Publishing also requires `WCA_ACCESS_TOKEN`.

```bash
bun run examples/basic.ts ExampleOpen2027 333-r1 4
bun run examples/custom-preferences.ts ExampleOpen2027 333-r1 4
bun run examples/availability.ts ExampleOpen2027 333-r1 3
bun run examples/later-round.ts ExampleOpen2027 333-r2 2
bun run examples/parallel-events.ts ExampleOpen2027 222-r1,444-r1,333oh-r1 3
bun run examples/groupifier/index.ts ExampleOpen2027
```

- `basic.ts` creates groups, assigns competitors and staff, numbers stations, and reports each group.
- `custom-preferences.ts` implements age ordering and birthday separation with public scoring hooks.
- `availability.ts` demonstrates that existing assignments are automatically treated as hard
  scheduling constraints.
- `later-round.ts` assigns only entrants present in synchronized target-round results.
- `parallel-events.ts` gives each person one consistent wave across all of their registered events.
  The round activities must cover identical time windows so their generated groups align.
- `groupifier/index.ts` reproduces Groupifier's complete assignment pipeline from static TypeScript
  configuration: multi-room capacity splits, all four competitor ordering modes, availability and
  role-coverage grouping, distributed attempts, staged scramblers/runners/judges, and stations.

Edit `examples/groupifier/config.ts` before running the Groupifier workflow.
`GROUPIFIER_OPTIONS.assignments` contains the former competition-wide assignment switches,
`GROUPIFIER_OPTIONS.rooms` sets timing-station counts, and `GROUPIFIER_OPTIONS.rounds` replaces
Groupifier's per-activity form. A configured round activity targets either a unique room name or an
exact WCIF activity ID, then declares its capacity, group count, scrambler count, runner count, and
whether judges should be assigned. Use an activity ID when a round has multiple blocks in one room.
Capacities within a round must total one. FMC and MBLD attempt activities are discovered from the
WCIF and do not need round configuration.

The legacy least-overlap competitor fallback is preserved. If a schedule leaves no conflict-free
group, the planner chooses the least-overlapping group exactly as Groupifier did, but TypeComp's
final validation still reports that collision as an error and prevents publishing it.

`assignParallelRounds` treats the first listed round's groups as wave definitions, assigns each
person to one wave, and applies that wave only to the listed events for which they are registered.
Its constraints and preferences are evaluated against those wave definitions. The operation is
atomic and requires identical round time windows. The resulting simultaneous competitor assignments
are validation warnings because they are intentional; competitor/staff overlaps and duplicate
competitor assignments within one activity remain errors.

Append `--publish` only after inspecting the dry-run summary:

```bash
WCA_ACCESS_TOKEN='...' bun run examples/basic.ts ExampleOpen2027 333-r1 4 --publish
```

## Live results and later rounds

The remote competition is the source of truth. TypeComp deliberately does not guess advancement.
For round 2 and later, the default entrant set comes from that round's synchronized WCIF results. If
the target round has no result rows yet, assignment stops with an actionable error. You may pass an
explicit `select` predicate when you intentionally own the entrant decision.

Publishing performs another authorized fetch before writing:

- Assignment changes are rejected if remote assignments changed since the session was loaded.
- Schedule changes are rejected if the remote schedule changed.
- Scramble-set counts are merged into the fresh event data, preserving newly synchronized results.
- Only changed top-level WCIF sections are patched.

This prevents a planning script from overwriting results that arrived while it was running. The WCA's
public endpoint can be cached; use an authenticated client for operational work and synchronize the
competition's live results before assigning a later round.

## Working without the API

Use an existing WCIF in memory and export the result as plain data:

```ts
const session = CompetitionSession.fromCompetition(wcif);
session.round('333-r1').createGroups({ count: 3 });
await session.round('333-r1').assignCompetitors();
const updatedWcif = session.export();
```

The session clones input and output. Callers cannot accidentally mutate its baseline, which is needed
for safe conflict detection.

## OAuth

`WcaClient` accepts an OAuth bearer token; it does not own an interactive login flow or persist
credentials. Create an OAuth application through the WCA website, obtain a token in the host
application, and pass it as `accessToken`. Keeping authentication outside this library avoids hidden
files, local callback servers, refresh races, and environment-specific credential behavior.

Without a token, fetching uses the public endpoint and publishing is disabled.

## Migrating from 0.2

Version 1.0 is an architecture reset, not a source-compatible update. The fluent builders, embedded
OAuth callback server, local WCIF cache, and competition-specific scripts were removed. Replace
`createTypeComp` with `CompetitionSession`, pass assignment rules as explicit options, and keep token
storage or local snapshots in the host application. This keeps I/O ownership visible and prevents a
cached document from silently becoming the planning source of truth.

## Guarantees and optimization scope

The built-in strategy guarantees a complete solution for its declared hard model: each selected
person exactly once, balanced fixed group capacities, and person-to-group constraints. Preference
improvement is deterministic but locally optimized; no general solver can cheaply promise a global
optimum for arbitrary pairwise scoring at competition scale.

Staff matching is exact within each activity and uses most-constrained-first ordering across
activities. It is not a global interval-scheduling optimizer, so unusually coupled parallel-stage
staffing may need to be divided into explicit activity plans.

If your rules need global cardinality constraints such as “at most two delegates per group,” implement
a `GroupAssignmentStrategy` backed by a constraint-programming solver. TypeComp validates that a
custom strategy returns every person exactly once before applying it.

## Project layout

```text
src/
  domain/       WCIF traversal, activity codes, time, and public types
  planning/     Atomic group, competitor, and staff operations
  solver/       Generic exact matching and the default group strategy
  session.ts    Change tracking and live-safe publishing
  validation.ts WCIF assignment and schedule invariants
  wca-client.ts Narrow WCA HTTP transport
examples/       Runnable, dry-run-first operational workflows
test/           Behavior-focused fixtures and integration tests
```

Every source file is intentionally small and single-purpose. The public surface is exported from
`src/index.ts`; internal solver machinery stays internal unless it is a supported extension point.
