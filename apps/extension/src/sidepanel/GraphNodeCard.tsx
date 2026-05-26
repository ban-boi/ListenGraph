import { Handle, Position, type NodeProps } from 'reactflow';

import type { GraphNodeData } from './types';
import { formatTime } from './timeline-utils';

// ============ 工具函数 ============

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    claim: '#3b82f6',
    reason: '#10b981',
    example: '#f59e0b',
    question: '#8b5cf6',
    conclusion: '#ef4444',
  };
  return colors[type] || '#6b7280';
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    claim: '观点',
    reason: '论据',
    example: '例子',
    question: '问题',
    conclusion: '结论',
  };
  return labels[type] || type;
}

// ============ 自定义节点组件 ============

export function GraphNodeCard({ data, id }: NodeProps<GraphNodeData>) {
  const {
    label,
    nodeType,
    speaker,
    timestampMs,
    status,
    isActive,
    displayMode = 'readable',
    isTourAnchor = false,
    isTourAdded = false,
    onClickTime,
  } = data;
  const color = getTypeColor(nodeType);
  const isCompact = displayMode === 'compact';
  const displayLabel = isCompact && label.length > 56
    ? `${label.slice(0, 54)}…`
    : label;

  return (
    <div
      data-testid={`graph-node-card-${id}`}
      data-display-mode={displayMode}
      data-tour-anchor={isTourAnchor ? 'true' : 'false'}
      data-tour-added={isTourAdded ? 'true' : 'false'}
      style={{
        padding: isCompact ? '6px 8px' : '10px 12px',
        borderRadius: 6,
        border: `2px solid ${isActive || isTourAdded ? '#f59e0b' : color}`,
        backgroundColor: isActive || isTourAdded ? '#fffbeb' : '#ffffff',
        boxShadow: isActive || isTourAdded
          ? '0 0 8px rgba(245, 158, 11, 0.4)'
          : '0 1px 4px rgba(0,0,0,0.1)',
        minWidth: isCompact ? 112 : 140,
        maxWidth: isCompact ? 168 : 200,
        opacity: status === 'draft' ? 0.6 : isTourAnchor ? 0.72 : 1,
        transition: 'all 0.2s ease',
      }}
    >
      <Handle
        key="target-top"
        type="target"
        position={Position.Top}
        id="target-top"
        data-testid="graph-handle-target-top"
        isConnectable={false}
        style={{ width: 6, height: 6 }}
      />
      <Handle
        key="source-top"
        type="source"
        position={Position.Top}
        id="source-top"
        data-testid="graph-handle-source-top"
        isConnectable={false}
        style={{ width: 6, height: 6, opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        key="target-left"
        type="target"
        position={Position.Left}
        id="target-left"
        data-testid="graph-handle-target-left"
        isConnectable={false}
        style={{ width: 6, height: 6 }}
      />
      <Handle
        key="source-left"
        type="source"
        position={Position.Left}
        id="source-left"
        data-testid="graph-handle-source-left"
        isConnectable={false}
        style={{ width: 6, height: 6, opacity: 0, pointerEvents: 'none' }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 9,
            padding: '1px 4px',
            borderRadius: 3,
            backgroundColor: color,
            color: 'white',
            fontWeight: 600,
          }}
        >
          {getTypeLabel(nodeType)}
        </span>
        {status === 'draft' && (
          <span style={{ fontSize: 9, color: '#9ca3af' }}>草稿</span>
        )}
      </div>

      <div
        style={{
          fontSize: isCompact ? 11 : 12,
          lineHeight: isCompact ? 1.25 : 1.3,
          marginBottom: isCompact ? 4 : 6,
          display: '-webkit-box',
          WebkitLineClamp: isCompact ? 2 : 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {displayLabel}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: isCompact ? 9 : 10,
          color: '#6b7280',
        }}
      >
        {speaker && <span>{speaker}</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClickTime(timestampMs);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#3b82f6',
            cursor: 'pointer',
            fontFamily: 'monospace',
            padding: 0,
            fontSize: isCompact ? 9 : 10,
          }}
        >
          {formatTime(timestampMs)}
        </button>
      </div>

      <Handle
        key="target-bottom"
        type="target"
        position={Position.Bottom}
        id="target-bottom"
        data-testid="graph-handle-target-bottom"
        isConnectable={false}
        style={{ width: 6, height: 6, opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        key="source-bottom"
        type="source"
        position={Position.Bottom}
        id="source-bottom"
        data-testid="graph-handle-source-bottom"
        isConnectable={false}
        style={{ width: 6, height: 6 }}
      />
      <Handle
        key="target-right"
        type="target"
        position={Position.Right}
        id="target-right"
        data-testid="graph-handle-target-right"
        isConnectable={false}
        style={{ width: 6, height: 6, opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        key="source-right"
        type="source"
        position={Position.Right}
        id="source-right"
        data-testid="graph-handle-source-right"
        isConnectable={false}
        style={{ width: 6, height: 6 }}
      />
    </div>
  );
}
