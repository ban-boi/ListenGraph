import { describe, it, expect } from 'vitest';
import { resolveEdgeHandles } from './graph-utils';

describe('resolveEdgeHandles', () => {
  it('正上→正下：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 60, y: 200 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('正下→正上：选择最顺的可见组合', () => {
    const result = resolveEdgeHandles({ x: 60, y: 240 }, { x: 60, y: 0 });
    expect(result.sourceHandle).not.toBe('source-top');
    expect(result.sourceHandle).not.toBe('source-left');
    expect(result.targetHandle).not.toBe('target-bottom');
    expect(result.targetHandle).not.toBe('target-right');
  });

  it('正左→正右：right→left', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 420, y: 10 }),
    ).toEqual({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
    });
  });

  it('正右→正左：选择最顺的可见组合', () => {
    const result = resolveEdgeHandles({ x: 420, y: 0 }, { x: 60, y: 10 });
    expect(result.sourceHandle).not.toBe('source-top');
    expect(result.sourceHandle).not.toBe('source-left');
    expect(result.targetHandle).not.toBe('target-bottom');
    expect(result.targetHandle).not.toBe('target-right');
  });

  it('右下→左上（反向 edge）：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 340, y: 0 }, { x: 60, y: 200 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('左下→右上（反向 edge）：right→left', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 200 }, { x: 340, y: 0 }),
    ).toEqual({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
    });
  });

  it('分支→主节点：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 340, y: 100 }, { x: 60, y: 300 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('对角线死区：选择最顺的组合，不使用隐藏 handle', () => {
    const result = resolveEdgeHandles({ x: 60, y: 0 }, { x: 240, y: 180 });
    expect(
      result.sourceHandle === 'source-bottom' || result.sourceHandle === 'source-right',
    ).toBe(true);
    expect(
      result.targetHandle === 'target-top' || result.targetHandle === 'target-left',
    ).toBe(true);
    expect(result.sourceHandle).not.toBe('source-top');
    expect(result.sourceHandle).not.toBe('source-left');
    expect(result.targetHandle).not.toBe('target-bottom');
    expect(result.targetHandle).not.toBe('target-right');
  });
});

import type { EdgeType } from '@listen-graphic/schema';
import { VIEW_EDGE_PRIORITIES } from './constants';
import type { ViewType } from '@listen-graphic/schema';

describe('VIEW_EDGE_PRIORITIES', () => {
  it('causal 视图隐藏 follows 边', () => {
    expect(VIEW_EDGE_PRIORITIES.causal.follows).toBe('hidden');
  });

  it('causal 视图将 causes 设为 primary', () => {
    expect(VIEW_EDGE_PRIORITIES.causal.causes).toBe('primary');
  });

  it('hierarchy 视图隐藏 opposes 和 follows', () => {
    expect(VIEW_EDGE_PRIORITIES.hierarchy.opposes).toBe('hidden');
    expect(VIEW_EDGE_PRIORITIES.hierarchy.follows).toBe('hidden');
  });

  it('comparison 视图隐藏 follows 和 example_of', () => {
    expect(VIEW_EDGE_PRIORITIES.comparison.follows).toBe('hidden');
    expect(VIEW_EDGE_PRIORITIES.comparison.example_of).toBe('hidden');
  });

  it('每个视图的五种边类型都有定义', () => {
    const edgeTypes: EdgeType[] = ['supports', 'opposes', 'causes', 'follows', 'example_of'];
    const views: ViewType[] = ['causal', 'timeline', 'comparison', 'hierarchy'];
    for (const view of views) {
      for (const et of edgeTypes) {
        expect(VIEW_EDGE_PRIORITIES[view][et]).toBeDefined();
      }
    }
  });
});
