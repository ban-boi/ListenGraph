import { describe, it, expect } from 'vitest';
import { resolveEdgeHandles } from './graph-utils';

describe('resolveEdgeHandles', () => {
  it('垂直向下时使用 bottom -> top', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 60, y: 200 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('垂直向上时使用 top -> bottom', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 240 }, { x: 60, y: 0 }),
    ).toEqual({
      sourceHandle: 'source-top',
      targetHandle: 'target-bottom',
    });
  });

  it('水平向右时使用 right -> left', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 420, y: 10 }),
    ).toEqual({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
    });
  });

  it('对角线但横纵接近时退回 bottom -> top', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 240, y: 180 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });
});
