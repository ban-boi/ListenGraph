import { Handle, Position, type NodeProps } from 'reactflow';

import {
  formatGraphNodeTime,
  getGraphNodeTypeColor,
  getGraphNodeTypeLabel,
} from './graph-node-utils';
import type { GraphNodeCardData, GraphNodeHandleMode } from './types';

export type GraphNodeCardProps = NodeProps<GraphNodeCardData> & {
  handleMode?: GraphNodeHandleMode;
};

export function GraphNodeCard({
  data,
  id,
  handleMode = 'multi',
}: GraphNodeCardProps) {
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
  const color = getGraphNodeTypeColor(nodeType);
  const isCompact = displayMode === 'compact';
  const displayLabel =
    isCompact && label.length > 56 ? `${label.slice(0, 54)}…` : label;

  const rootClassName = [
    'lg-node-card',
    status === 'draft' ? 'lg-node-card--draft' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClassName}
      data-testid={`graph-node-card-${id}`}
      data-display-mode={displayMode}
      data-tour-anchor={isTourAnchor ? 'true' : 'false'}
      data-tour-added={isTourAdded ? 'true' : 'false'}
      style={{
        padding: isCompact ? '8px 10px' : 'var(--sp-4)',
        borderRadius: 'var(--radius-md)',
        borderWidth: 1.5,
        borderStyle: status === 'draft' ? 'dashed' : 'solid',
        borderColor: isActive || isTourAdded ? 'var(--lg-insight)' : color,
        backgroundColor: isActive || isTourAdded ? 'var(--lg-insight-glow)' : 'var(--lg-surface)',
        boxShadow:
          isActive || isTourAdded
            ? '0 0 8px rgba(245, 158, 11, 0.4)'
            : 'var(--shadow-xs)',
        ...(data.nodeSize
          ? { width: data.nodeSize.width, height: data.nodeSize.height, boxSizing: 'border-box' as const, overflow: 'hidden' as const }
          : { minWidth: isCompact ? 140 : 220, maxWidth: isCompact ? 200 : 260 }),
        opacity: status === 'draft' ? 0.7 : isTourAnchor ? 0.72 : 1,
        transition: 'all var(--dur-normal) var(--ease-out)',
      }}
    >
      {handleMode === 'multi' ? (
        <>
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
        </>
      ) : (
        <Handle type="target" position={Position.Top} />
      )}

      <div
        data-testid="graph-node-card-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 'var(--text-2xs)',
              padding: '2px var(--sp-2)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: color,
              color: 'var(--lg-surface)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {getGraphNodeTypeLabel(nodeType)}
          </span>
          {status === 'draft' && (
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--lg-mist)', whiteSpace: 'nowrap' }}>
              草稿
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClickTime(timestampMs);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--lg-signal)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            padding: 0,
            fontSize: 'var(--text-2xs)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {formatGraphNodeTime(timestampMs)}
        </button>
      </div>

      <div
        data-testid="graph-node-card-body"
        style={{
          fontSize: isCompact ? 'var(--text-xs)' : 'var(--text-sm)',
          lineHeight: isCompact ? 1.25 : 1.3,
          marginBottom: speaker ? (isCompact ? 4 : 6) : 0,
          display: '-webkit-box',
          WebkitLineClamp: isCompact ? 2 : 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {displayLabel}
      </div>

      {speaker ? (
        <div
          data-testid="graph-node-card-speaker"
          style={{
            fontSize: 'var(--text-2xs)',
            color: 'var(--lg-muted)',
          }}
        >
          {speaker}
        </div>
      ) : null}

      {handleMode === 'multi' ? (
        <>
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
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  );
}
