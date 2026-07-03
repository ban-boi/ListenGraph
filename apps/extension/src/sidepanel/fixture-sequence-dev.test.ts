import { describe, expect, it } from 'vitest';

import { installFixtureSequenceDev } from './fixture-sequence-dev';
import type { FixtureLabDeps } from './fixture-sequence-controller';
import { createFixtureSequenceController } from './fixture-sequence-controller';
import type { MergedGraph } from '@listen-graphic/schema';

function makeDeps(): FixtureLabDeps {
  return {
    dispatch: () => undefined,
    graphRef: { current: null as never },
    activeViewSessionRef: { current: null },
    addLog: () => undefined,
    setAutoTourSeed: () => undefined,
    onFixtureLabReset: () => undefined,
  };
}

describe('fixture sequence DEV registry', () => {
  it('lists semantic pattern fixtures', () => {
    const previousApi = globalThis.__listenGraphicFixture;

    try {
      installFixtureSequenceDev({ current: makeDeps() });

      expect(globalThis.__listenGraphicFixture?.list()).toEqual(
        expect.arrayContaining([
          'seq-incremental-growth',
          'seq-late-burst',
          'seq-view-switch-mid',
          'seq-pattern-question-three-points',
          'seq-pattern-claim-reason-example',
          'seq-pattern-opposition',
          'seq-pattern-causal-chain',
          'seq-pattern-timeline-note',
        ]),
      );
    } finally {
      globalThis.__listenGraphicFixture = previousApi;
    }
  });
});

function makeDepsWithCapture() {
  const dispatched: unknown[] = [];
  const graphRef = { current: null as MergedGraph | null };
  return {
    deps: {
      dispatch: (a: unknown) => dispatched.push(a),
      graphRef,
      activeViewSessionRef: { current: null as string | null },
      addLog: () => undefined,
      setAutoTourSeed: () => undefined,
      onFixtureLabReset: () => undefined,
    } as any,
    dispatched,
    graphRef,
  };
}

describe('fixture loadGraph (layout-lab)', () => {
  it('loadGraph 静态装载：dispatch FIXTURE_SEQUENCE_ARM，不触发 auto-tour，设 graphRef + loadedGraph', () => {
    const { deps, dispatched, graphRef } = makeDepsWithCapture();
    const ctrl = createFixtureSequenceController(
      () => deps,
      { list: () => [], load: () => null },
    );
    const graph: MergedGraph = {
      sessionId: 'lab-1', revision: 3, topics: [],
      nodes: [
        { id: 'n1', type: 'claim', text: 'x', timestampMs: 0, status: 'confirmed' },
        { id: 'n2', type: 'claim', text: 'y', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'opposes' }],
      updatedAt: 0,
    };

    (ctrl as any).loadGraph(graph);

    // 断言 1：dispatch 了 FIXTURE_SEQUENCE_ARM（静态装载路径）
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as any).type).toBe('FIXTURE_SEQUENCE_ARM');
    expect((dispatched[0] as any).payload.initialGraph).toBe(graph);
    expect((dispatched[0] as any).payload.sessionId).toBe('lab-1');

    // 断言 2：graphRef 更新
    expect(graphRef.current).toBe(graph);

    // 断言 3（Blocker 修复验证）：status 读 loadedGraph，nodeCount 正确
    expect(ctrl.status().nodeCount).toBe(2);
    expect(ctrl.status().revision).toBe(3);
    expect(ctrl.status().isArmed).toBe(false);
  });

  it('loadGraph 不触发 setAutoTourSeed（避免导览高亮污染截图）', () => {
    let autoTourCalls = 0;
    const { deps } = makeDepsWithCapture();
    deps.setAutoTourSeed = () => { autoTourCalls += 1; };
    const ctrl = createFixtureSequenceController(
      () => deps,
      { list: () => [], load: () => null },
    );
    const graph: MergedGraph = {
      sessionId: 'lab-1', revision: 1, topics: [],
      nodes: [{ id: 'n1', type: 'claim', text: 'x', timestampMs: 0, status: 'confirmed' }],
      edges: [], updatedAt: 0,
    };
    (ctrl as any).loadGraph(graph);
    expect(autoTourCalls).toBe(0);
  });

  it('arm() 后 loadedGraph 被清空（status 不再返回 loaded 图）', () => {
    const { deps } = makeDepsWithCapture();
    const ctrl = createFixtureSequenceController(
      () => deps,
      { list: () => ['seq-x'], load: () => null },
    );
    const graph: MergedGraph = {
      sessionId: 'lab-1', revision: 1, topics: [],
      nodes: [{ id: 'n1', type: 'claim', text: 'x', timestampMs: 0, status: 'confirmed' }],
      edges: [], updatedAt: 0,
    };
    (ctrl as any).loadGraph(graph);
    expect(ctrl.status().nodeCount).toBe(1);

    // arm 一个不存在的 sequence（load 返回 null → arm early-returns after reset logic）
    ctrl.arm('seq-x');
    // loadedGraph 应被清，status 回到空（armed=false 因为 load 返回 null）
    expect(ctrl.status().nodeCount).toBe(0);
  });
});
