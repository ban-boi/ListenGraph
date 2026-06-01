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

function hierarchyViewHints() {
  return {
    defaultView: 'hierarchy',
    scores: { hierarchy: 5, causal: 1, comparison: 1, timeline: 1 },
  };
}

function causalViewHints() {
  return {
    defaultView: 'causal',
    scores: { causal: 5, hierarchy: 2, comparison: 1, timeline: 1 },
  };
}

function timelineViewHints() {
  return {
    defaultView: 'timeline',
    scores: { timeline: 5, causal: 2, hierarchy: 2, comparison: 1 },
  };
}

function makePatternSteps(sessionId, label, rootNodes, nodes, edges, viewHints) {
  return [
    {
      label: `${label}-root`,
      graph: makeGraph(sessionId, 1, rootNodes, [], viewHints),
    },
    {
      label,
      graph: makeGraph(sessionId, 2, nodes, edges, viewHints),
    },
  ];
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

function buildPatternQuestionThreePoints() {
  const id = 'seq-pattern-question-three-points';
  const sessionId = 'fixture-seq-pattern-question-three-points';
  const nodes = [
    makeNode('q1', 'question', '这个产品开源前还有哪三个问题？', 0),
    makeNode('p1', 'claim', 'UI 还不统一', 1000),
    makeNode('p2', 'claim', '图形逻辑不够清楚', 2000),
    makeNode('p3', 'claim', '代码架构需要清理', 3000),
  ];
  const edges = [
    makeEdge('e1', 'q1', 'p1', 'supports'),
    makeEdge('e2', 'q1', 'p2', 'supports'),
    makeEdge('e3', 'q1', 'p3', 'supports'),
  ];

  return {
    id,
    kind: 'sequence',
    description: 'Semantic pattern: question fans out into three claim branches',
    sessionId,
    visualExpectations: {
      rootNode: 'q1',
      branchNodes: ['p1', 'p2', 'p3'],
      layout: 'fanout',
      noOverlap: true,
      edgeHandlesReasonable: true,
      autoTourReadable: true,
    },
    playback: { preserveView: true },
    steps: makePatternSteps(
      sessionId,
      'question-three-points',
      [nodes[0]],
      nodes,
      edges,
      hierarchyViewHints(),
    ),
  };
}

function buildPatternClaimReasonExample() {
  const id = 'seq-pattern-claim-reason-example';
  const sessionId = 'fixture-seq-pattern-claim-reason-example';
  const nodes = [
    makeNode('c1', 'claim', '定价页应该先讲清楚价值', 0),
    makeNode('r1', 'reason', '用户先判断是否值得继续了解', 1000),
    makeNode('x1', 'example', '例如把用例收益放在套餐表之前', 2000),
  ];
  const edges = [
    makeEdge('e1', 'c1', 'r1', 'supports'),
    makeEdge('e2', 'r1', 'x1', 'example_of'),
  ];

  return {
    id,
    kind: 'sequence',
    description: 'Semantic pattern: claim -> reason -> example',
    sessionId,
    visualExpectations: {
      rootNode: 'c1',
      branchNodes: ['r1', 'x1'],
      layout: 'support-chain',
      noOverlap: true,
      edgeHandlesReasonable: true,
      autoTourReadable: true,
    },
    playback: { preserveView: true },
    steps: makePatternSteps(
      sessionId,
      'claim-reason-example',
      [nodes[0]],
      nodes,
      edges,
      hierarchyViewHints(),
    ),
  };
}

function buildPatternOpposition() {
  const id = 'seq-pattern-opposition';
  const sessionId = 'fixture-seq-pattern-opposition';
  const nodes = [
    makeNode('a1', 'claim', '应该继续打磨视觉细节', 0),
    makeNode('b1', 'claim', '现在更应该先补图形语法', 1000),
    makeNode('r1', 'reason', '没有稳定表达模式时，视觉 polish 不能解决可读性', 2000),
  ];
  const edges = [
    makeEdge('e1', 'b1', 'a1', 'opposes'),
    makeEdge('e2', 'b1', 'r1', 'supports'),
  ];

  return {
    id,
    kind: 'sequence',
    description: 'Semantic pattern: one claim opposes another claim',
    sessionId,
    visualExpectations: {
      rootNode: 'b1',
      branchNodes: ['a1', 'r1'],
      layout: 'opposition',
      noOverlap: true,
      edgeHandlesReasonable: true,
      autoTourReadable: true,
    },
    playback: { preserveView: true },
    steps: makePatternSteps(
      sessionId,
      'opposition',
      [nodes[1]],
      nodes,
      edges,
      hierarchyViewHints(),
    ),
  };
}

function buildPatternCausalChain() {
  const id = 'seq-pattern-causal-chain';
  const sessionId = 'fixture-seq-pattern-causal-chain';
  const nodes = [
    makeNode('c1', 'claim', '启动时一次性加载太多模块', 0),
    makeNode('c2', 'claim', '首屏渲染被阻塞', 1000),
    makeNode('c3', 'claim', '用户觉得应用很慢', 2000),
    makeNode('c4', 'conclusion', '需要拆分启动路径', 3000),
  ];
  const edges = [
    makeEdge('e1', 'c1', 'c2', 'causes'),
    makeEdge('e2', 'c2', 'c3', 'causes'),
    makeEdge('e3', 'c3', 'c4', 'causes'),
  ];

  return {
    id,
    kind: 'sequence',
    description: 'Semantic pattern: causal chain',
    sessionId,
    visualExpectations: {
      rootNode: 'c1',
      chainNodes: ['c1', 'c2', 'c3', 'c4'],
      layout: 'causal-chain',
      noOverlap: true,
      edgeHandlesReasonable: true,
      autoTourReadable: true,
    },
    playback: { preserveView: true },
    steps: makePatternSteps(
      sessionId,
      'causal-chain',
      [nodes[0]],
      nodes,
      edges,
      causalViewHints(),
    ),
  };
}

function buildPatternTimelineNote() {
  const id = 'seq-pattern-timeline-note';
  const sessionId = 'fixture-seq-pattern-timeline-note';
  const nodes = [
    makeNode('t1', 'claim', '先完成核心布局规则', 0),
    makeNode('t2', 'claim', '再补语义 fixture', 1000),
    makeNode('t3', 'conclusion', '最后做视觉验收', 2000),
    makeNode('n1', 'example', '验收时重点看一眼是否读得懂', 2500),
  ];
  const edges = [
    makeEdge('e1', 't1', 't2', 'follows'),
    makeEdge('e2', 't2', 't3', 'follows'),
    makeEdge('e3', 't3', 'n1', 'supports'),
  ];

  return {
    id,
    kind: 'sequence',
    description: 'Semantic pattern: timeline with supplementary note',
    sessionId,
    visualExpectations: {
      rootNode: 't1',
      chainNodes: ['t1', 't2', 't3'],
      branchNodes: ['n1'],
      layout: 'timeline-note',
      noOverlap: true,
      edgeHandlesReasonable: true,
      autoTourReadable: true,
    },
    playback: { preserveView: true },
    steps: makePatternSteps(
      sessionId,
      'timeline-note',
      [nodes[0]],
      nodes,
      edges,
      timelineViewHints(),
    ),
  };
}

const sequences = [
  buildIncrementalGrowth(),
  buildLateBurst(),
  buildViewSwitchMid(),
  buildPatternQuestionThreePoints(),
  buildPatternClaimReasonExample(),
  buildPatternOpposition(),
  buildPatternCausalChain(),
  buildPatternTimelineNote(),
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
    {
      id: 'seq-pattern-question-three-points',
      file: 'sequences/seq-pattern-question-three-points.json',
      tags: ['semantic-pattern', 'question', 'fanout'],
      primaryView: 'hierarchy',
      description: 'Question fans out into three claim branches',
    },
    {
      id: 'seq-pattern-claim-reason-example',
      file: 'sequences/seq-pattern-claim-reason-example.json',
      tags: ['semantic-pattern', 'support-chain'],
      primaryView: 'hierarchy',
      description: 'Claim -> reason -> example',
    },
    {
      id: 'seq-pattern-opposition',
      file: 'sequences/seq-pattern-opposition.json',
      tags: ['semantic-pattern', 'opposition'],
      primaryView: 'hierarchy',
      description: 'A claim opposes another claim',
    },
    {
      id: 'seq-pattern-causal-chain',
      file: 'sequences/seq-pattern-causal-chain.json',
      tags: ['semantic-pattern', 'causal-chain'],
      primaryView: 'causal',
      description: 'Cause -> effect -> consequence chain',
    },
    {
      id: 'seq-pattern-timeline-note',
      file: 'sequences/seq-pattern-timeline-note.json',
      tags: ['semantic-pattern', 'timeline-note'],
      primaryView: 'timeline',
      description: 'Timeline with a supplementary note',
    },
  ],
  snapshots: [],
};

writeFileSync(join(fixturesDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

console.log(`Wrote ${sequences.length} sequence fixture(s) and manifest.json`);
