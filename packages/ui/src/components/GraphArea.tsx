import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
} from 'reactflow';
import { EmptyState } from '../EmptyState';

export type GraphAreaProps = {
  /** ReactFlow 节点 */
  nodes: Node[];
  /** ReactFlow 边 */
  edges: Edge[];
  /** 自定义节点类型注册 */
  nodeTypes: NodeTypes;
  /** 是否处于空闲状态（无节点 + 空闲 → 显示 EmptyState） */
  isIdle: boolean;
  /** 节点点击回调 */
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  /** ReactFlow 初始化回调 */
  onInit?: (instance: ReactFlowInstance) => void;
  /** 视口移动开始回调 */
  onMoveStart?: () => void;
  /** 视口移动结束回调 */
  onMoveEnd?: () => void;
  /** 额外的 ReactFlow children（如 MiniMap） */
  children?: React.ReactNode;
  /** fitView 初始是否自适应 */
  fitView?: boolean;
  /** 最小缩放 */
  minZoom?: number;
  /** 最大缩放 */
  maxZoom?: number;
};

export function GraphArea({
  nodes,
  edges,
  nodeTypes,
  isIdle,
  onNodeClick,
  onInit,
  onMoveStart,
  onMoveEnd,
  children,
  fitView = false,
  minZoom = 0.3,
  maxZoom = 2,
}: GraphAreaProps) {
  if (nodes.length === 0 && isIdle) {
    return <EmptyState />;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        onInit={onInit}
        fitView={fitView}
        minZoom={minZoom}
        maxZoom={maxZoom}
      >
        <Background />
        <Controls />
        {children}
      </ReactFlow>
    </div>
  );
}
