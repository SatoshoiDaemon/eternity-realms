import type { NodeGraph } from './graph';

export interface GraphHistory {
  past: NodeGraph[];
  future: NodeGraph[];
}

export interface GraphHistoryTransition {
  graph: NodeGraph;
  history: GraphHistory;
  versionDelta: 0 | 1;
}

export function undoGraphHistory(
  history: GraphHistory,
  current: NodeGraph,
): GraphHistoryTransition {
  const previous = history.past.at(-1);
  if (!previous) return { graph: current, history, versionDelta: 0 };
  return {
    graph: previous,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future].slice(0, 50),
    },
    versionDelta: 1,
  };
}

export function redoGraphHistory(
  history: GraphHistory,
  current: NodeGraph,
): GraphHistoryTransition {
  const next = history.future[0];
  if (!next) return { graph: current, history, versionDelta: 0 };
  return {
    graph: next,
    history: {
      past: [...history.past, current].slice(-50),
      future: history.future.slice(1),
    },
    versionDelta: 1,
  };
}
