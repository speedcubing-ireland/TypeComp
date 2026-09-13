import { InfeasibleAssignmentError, PlanningError } from '../errors';

export interface MatchingConstraint<Item, Bin> {
  readonly name: string;
  allows(item: Item, bin: Bin): boolean;
}

export interface MatchingProblem<Item, Bin> {
  readonly items: readonly Item[];
  readonly bins: readonly Bin[];
  readonly capacities: readonly number[];
  readonly constraints?: readonly MatchingConstraint<Item, Bin>[];
  readonly score?: (item: Item, bin: Bin) => number;
  readonly describeItem?: (item: Item) => string;
}

interface Edge {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
}

interface Network {
  readonly graph: Edge[][];
  readonly source: number;
  readonly sink: number;
  readonly assignmentEdges: Array<Array<Edge | undefined>>;
}

function node(graph: Edge[][], index: number): Edge[] {
  const result = graph[index];
  if (!result) throw new RangeError(`Graph node ${index} does not exist.`);
  return result;
}

function addEdge(
  graph: Edge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number,
) {
  const fromNode = node(graph, from);
  const toNode = node(graph, to);
  const forward: Edge = { to, reverse: toNode.length, capacity, cost };
  const backward: Edge = { to: from, reverse: fromNode.length, capacity: 0, cost: -cost };
  fromNode.push(forward);
  toNode.push(backward);
  return forward;
}

function relaxNode(
  graph: readonly Edge[][],
  from: number,
  distance: number[],
  previousNode: number[],
  previousEdge: number[],
): boolean {
  const fromDistance = distance[from];
  if (fromDistance === undefined || !Number.isFinite(fromDistance)) return false;
  let changed = false;
  for (const [edgeIndex, edge] of (graph[from] ?? []).entries()) {
    const candidate = fromDistance + edge.cost;
    if (edge.capacity > 0 && candidate < (distance[edge.to] ?? Infinity)) {
      distance[edge.to] = candidate;
      previousNode[edge.to] = from;
      previousEdge[edge.to] = edgeIndex;
      changed = true;
    }
  }
  return changed;
}

function relaxAll(
  graph: readonly Edge[][],
  distance: number[],
  previousNode: number[],
  previousEdge: number[],
): boolean {
  let changed = false;
  for (let from = 0; from < graph.length; from += 1) {
    if (relaxNode(graph, from, distance, previousNode, previousEdge)) changed = true;
  }
  return changed;
}

function shortestPath(graph: readonly Edge[][], source: number) {
  const distance = Array<number>(graph.length).fill(Number.POSITIVE_INFINITY);
  const previousNode = Array<number>(graph.length).fill(-1);
  const previousEdge = Array<number>(graph.length).fill(-1);
  distance[source] = 0;

  for (let pass = 1; pass < graph.length; pass += 1) {
    if (!relaxAll(graph, distance, previousNode, previousEdge)) break;
  }
  return { distance, previousNode, previousEdge };
}

function augment(network: Network): boolean {
  const path = shortestPath(network.graph, network.source);
  if (!Number.isFinite(path.distance[network.sink])) return false;
  for (let current = network.sink; current !== network.source; ) {
    const from = path.previousNode[current] ?? -1;
    const edgeIndex = path.previousEdge[current] ?? -1;
    if (from < 0 || edgeIndex < 0) return false;
    const edge = node(network.graph, from)[edgeIndex];
    if (!edge) return false;
    edge.capacity -= 1;
    const reverse = node(network.graph, current)[edge.reverse];
    if (!reverse) return false;
    reverse.capacity += 1;
    current = from;
  }
  return true;
}

function validateProblem<Item, Bin>(problem: MatchingProblem<Item, Bin>): void {
  if (problem.bins.length !== problem.capacities.length) {
    throw new TypeError('Every matching bin must have a capacity.');
  }
  if (
    problem.capacities.some((capacity) => !Number.isSafeInteger(capacity) || capacity < 0)
  ) {
    throw new TypeError('Matching capacities must be non-negative integers.');
  }
  if (problem.capacities.reduce((sum, value) => sum + value, 0) < problem.items.length) {
    throw new InfeasibleAssignmentError(
      'The matching problem has fewer slots than items.',
    );
  }
}

function buildNetwork<Item, Bin>(problem: MatchingProblem<Item, Bin>): Network {
  const source = 0;
  const itemOffset = 1;
  const binOffset = itemOffset + problem.items.length;
  const sink = binOffset + problem.bins.length;
  const graph = Array.from({ length: sink + 1 }, () => [] as Edge[]);
  const assignmentEdges: Array<Array<Edge | undefined>> = problem.items.map(() => []);

  for (const [itemIndex, item] of problem.items.entries()) {
    addEdge(graph, source, itemOffset + itemIndex, 1, 0);
    const itemEdges = assignmentEdges[itemIndex];
    if (!itemEdges) continue;
    for (const [binIndex, bin] of problem.bins.entries()) {
      const allowed =
        problem.constraints?.every((rule) => rule.allows(item, bin)) ?? true;
      if (!allowed) continue;
      const score = problem.score?.(item, bin) ?? 0;
      if (!Number.isFinite(score)) throw new TypeError('Matching scores must be finite.');
      itemEdges[binIndex] = addEdge(
        graph,
        itemOffset + itemIndex,
        binOffset + binIndex,
        1,
        -score,
      );
    }
  }
  for (const [binIndex, capacity] of problem.capacities.entries()) {
    addEdge(graph, binOffset + binIndex, sink, capacity, 0);
  }
  return { graph, source, sink, assignmentEdges };
}

function solveFlow(network: Network, requiredFlow: number): void {
  let flow = 0;
  while (flow < requiredFlow && augment(network)) flow += 1;
  if (flow !== requiredFlow) {
    throw new InfeasibleAssignmentError('No assignment satisfies all hard constraints.');
  }
}

function readSolution<Item, Bin>(
  problem: MatchingProblem<Item, Bin>,
  assignmentEdges: Network['assignmentEdges'],
): ReadonlyMap<Item, Bin> {
  const result = new Map<Item, Bin>();
  for (const [itemIndex, item] of problem.items.entries()) {
    const binIndex = (assignmentEdges[itemIndex] ?? []).findIndex(
      (edge) => edge?.capacity === 0,
    );
    const bin = problem.bins[binIndex];
    if (bin !== undefined) result.set(item, bin);
  }
  return result;
}

export function solveMatching<Item, Bin>(
  problem: MatchingProblem<Item, Bin>,
): ReadonlyMap<Item, Bin> {
  validateProblem(problem);
  const network = buildNetwork(problem);
  try {
    solveFlow(network, problem.items.length);
  } catch (error) {
    const unassignable = problem.items
      .filter((_, index) => (network.assignmentEdges[index] ?? []).every((edge) => !edge))
      .map((item) => problem.describeItem?.(item) ?? 'item');
    if (!(error instanceof InfeasibleAssignmentError) || unassignable.length === 0) {
      throw error;
    }
    const constraints = problem.constraints?.map((rule) => rule.name).join(', ');
    throw new InfeasibleAssignmentError(
      `${error.message} Unassignable: ${unassignable.join(', ')}.${constraints ? ` Constraints: ${constraints}.` : ''}`,
    );
  }
  return readSolution(problem, network.assignmentEdges);
}

export function balancedCapacities(
  itemCount: number,
  binCount: number,
  maximum?: number,
): number[] {
  if (!Number.isSafeInteger(itemCount) || itemCount < 0) {
    throw new PlanningError('The assignment item count must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(binCount) || binCount < 1) {
    throw new PlanningError('At least one assignment bin is required.');
  }
  if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 1)) {
    throw new PlanningError('The maximum bin capacity must be a positive integer.');
  }
  const base = Math.floor(itemCount / binCount);
  const remainder = itemCount % binCount;
  const capacities = Array.from(
    { length: binCount },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
  if (maximum !== undefined && capacities.some((capacity) => capacity > maximum)) {
    throw new PlanningError('The selected groups do not have enough capacity.', {
      candidates: itemCount,
      capacity: maximum * binCount,
    });
  }
  return capacities;
}
