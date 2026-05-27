import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturesDir = join(packageRoot, 'fixtures');
const sequencesDir = join(fixturesDir, 'sequences');

mkdirSync(sequencesDir, { recursive: true });

/** @param {string} id @param {string} type @param {string} text @param {number} timestampMs */
function makeNode(id, type, text, timestampMs) {
  return { id, type, text, timestampMs, status: 'confirmed' };
}

/** @param {string} id @param {string} source @param {string} target @param {string} type */
function makeEdge(id, source, target, type) {
  return { id, source, target, type };
}

/** @param {string} sessionId @param {number} revision @param {object[]} nodes @param {object[]} edges @param {object} [viewHints] */
function makeGraph(sessionId, revision, nodes, edges, viewHints = { defaultView: 'causal', scores: { causal: 5 } }) {
  return {
    sessionId,
    revision,
    topics: [],
    nodes,
    edges,
    viewHints,
    updatedAt: revision * 1000,
  };
}

function buildIncrementalGrowth() {
  const id = 'seq-incremental-growth';
  const sessionId = 'fixture-seq-incremental-growth';
  const nodeTypes = ['claim', 'reason', 'example', 'question', 'conclusion'];
  const edgeTypes = ['supports', 'causes', 'follows'];
  const targetCounts = [2, 4, 7, 9, 12, 14, 17, 22];

  /** @type {object[]} */
  const allNodes = [];
  /** @type {object[]} */
  const allEdges = [];
  /** @type {object[]} */
  const steps = [];

  for (let revision = 1; revision <= targetCounts.length; revision += 1) {
    const targetCount = targetCounts[revision - 1];

    while (allNodes.length < targetCount) {
      const nodeIndex = allNodes.length + 1;
      const nodeId = `n${nodeIndex}`;
      allNodes.push(
        makeNode(
          nodeId,
          nodeTypes[(nodeIndex - 1) % nodeTypes.length],
          `Incremental node ${nodeIndex}`,
          nodeIndex * 1000,
        ),
      );

      if (allNodes.length > 1) {
        const previousNode = allNodes[allNodes.length - 2];
        allEdges.push(
          makeEdge(
            `e${allEdges.length + 1}`,
            previousNode.id,
            nodeId,
            edgeTypes[(allEdges.length + revision) % edgeTypes.length],
          ),
        );
      }
    }

    steps.push({
      label: `rev-${revision}`,
      graph: makeGraph(sessionId, revision, [...allNodes], [...allEdges]),
    });
  }

  return {
    id,
    kind: 'sequence',
    description: '8 steps, nodes grow 2→~22',
    sessionId,
    playback: { preserveView: true },
    steps,
  };
}

function buildLateBurst() {
  const id = 'seq-late-burst';
  const sessionId = 'fixture-seq-late-burst';
  /** @type {object[]} */
  const steps = [];

  steps.push({
    label: 'rev-1',
    graph: makeGraph(sessionId, 1, [], []),
  });

  const seedNode = makeNode('n1', 'claim', 'Seed claim', 0);
  steps.push({
    label: 'rev-2',
    graph: makeGraph(sessionId, 2, [seedNode], []),
  });

  /** @type {object[]} */
  let nodes = [seedNode];
  /** @type {object[]} */
  let edges = [];

  for (let index = 2; index <= 13; index += 1) {
    nodes.push(makeNode(`n${index}`, 'reason', `Burst node ${index}`, index * 100));
    edges.push(makeEdge(`e${index - 1}`, 'n1', `n${index}`, 'supports'));
  }

  steps.push({
    label: 'rev-3',
    graph: makeGraph(sessionId, 3, [...nodes], [...edges]),
  });

  for (let index = 14; index <= 15; index += 1) {
    nodes.push(makeNode(`n${index}`, 'example', `Burst tail ${index}`, index * 100));
    edges.push(makeEdge(`e${index - 1}`, `n${index - 1}`, `n${index}`, 'follows'));
  }

  steps.push({
    label: 'rev-4',
    graph: makeGraph(sessionId, 4, [...nodes], [...edges]),
  });

  nodes.push(makeNode('n16', 'conclusion', 'Burst finale', 1600));
  edges.push(makeEdge('e15', 'n15', 'n16', 'causes'));

  steps.push({
    label: 'rev-5',
    graph: makeGraph(sessionId, 5, [...nodes], [...edges]),
  });

  return {
    id,
    kind: 'sequence',
    description: 'Late burst of ~15 nodes',
    sessionId,
    playback: { preserveView: true },
    steps,
  };
}

function buildViewSwitchMid() {
  const id = 'seq-view-switch-mid';
  const sessionId = 'fixture-seq-view-switch-mid';
  const causalViewHints = {
    defaultView: 'causal',
    scores: { causal: 5, comparison: 3 },
  };
  const timelineViewHints = {
    defaultView: 'timeline',
    scores: { timeline: 5, causal: 3, comparison: 3 },
  };

  /** @type {object[]} */
  const nodes = [];
  /** @type {object[]} */
  const edges = [];
  /** @type {object[]} */
  const steps = [];
  const targetCounts = [2, 3, 4, 6, 7, 8];

  for (let revision = 1; revision <= targetCounts.length; revision += 1) {
    while (nodes.length < targetCounts[revision - 1]) {
      const nodeIndex = nodes.length + 1;
      nodes.push(
        makeNode(
          `n${nodeIndex}`,
          nodeIndex === 1 ? 'claim' : 'reason',
          `View switch node ${nodeIndex}`,
          nodeIndex * 500,
        ),
      );

      if (nodes.length > 1) {
        edges.push(
          makeEdge(
            `e${edges.length + 1}`,
            `n${nodes.length - 1}`,
            `n${nodes.length}`,
            revision < 4 ? 'causes' : 'follows',
          ),
        );
      }
    }

    if (revision >= 4 && !edges.some((edge) => edge.type === 'opposes')) {
      edges.push(makeEdge('e-opp', 'n1', 'n5', 'opposes'));
    }

    steps.push({
      label: `rev-${revision}`,
      graph: makeGraph(
        sessionId,
        revision,
        [...nodes],
        [...edges],
        revision >= 4 ? timelineViewHints : causalViewHints,
      ),
    });
  }

  return {
    id,
    kind: 'sequence',
    description: 'Mid-sequence defaultView change',
    sessionId,
    playback: { preserveView: true },
    steps,
  };
}

const sequences = [
  buildIncrementalGrowth(),
  buildLateBurst(),
  buildViewSwitchMid(),
];

for (const sequence of sequences) {
  writeFileSync(
    join(sequencesDir, `${sequence.id}.json`),
    `${JSON.stringify(sequence, null, 2)}\n`,
    'utf-8',
  );
}

const manifest = {
  version: 1,
  sequences: [
    {
      id: 'seq-incremental-growth',
      file: 'sequences/seq-incremental-growth.json',
      tags: ['growth', 'autofit'],
      primaryView: 'causal',
      description: '8 steps, nodes grow 2→~24',
    },
    {
      id: 'seq-late-burst',
      file: 'sequences/seq-late-burst.json',
      tags: ['burst', 'auto-tour'],
      primaryView: 'causal',
      description: 'Late burst of ~15 nodes',
    },
    {
      id: 'seq-view-switch-mid',
      file: 'sequences/seq-view-switch-mid.json',
      tags: ['view-switch'],
      primaryView: 'causal',
      description: 'Mid-sequence defaultView change',
    },
  ],
  snapshots: [],
};

writeFileSync(join(fixturesDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

console.log(`Wrote ${sequences.length} sequence fixture(s) and manifest.json`);
