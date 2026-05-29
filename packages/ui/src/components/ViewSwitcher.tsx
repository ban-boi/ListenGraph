import type { ViewType } from '@listen-graphic/schema';
import { VIEW_TYPES, VIEW_LABELS } from '../constants/shared-constants';

export type ViewSwitcherProps = {
  /** 当前选中的视图 */
  currentView: ViewType;
  /** 视图切换回调 */
  onViewChange: (view: ViewType) => void;
  /** 适配视图回调（可选，提供时渲染"适配视图"按钮） */
  onFitView?: () => void;
  /** 适配视图按钮是否禁用 */
  fitViewDisabled?: boolean;
};

export function ViewSwitcher({
  currentView,
  onViewChange,
  onFitView,
  fitViewDisabled,
}: ViewSwitcherProps) {
  return (
    <div
      style={{
        padding: '6px 12px',
        borderBottom: '1px solid var(--lg-rim)',
        display: 'flex',
        gap: 6,
        flexShrink: 0,
        alignItems: 'center',
      }}
    >
      {VIEW_TYPES.map((v) => (
        <button
          key={v}
          className={
            currentView === v
              ? 'lg-btn lg-btn-primary lg-btn-sm'
              : 'lg-btn lg-btn-ghost lg-btn-sm'
          }
          onClick={() => onViewChange(v)}
        >
          {VIEW_LABELS[v]}
        </button>
      ))}
      {onFitView && (
        <button
          className="lg-btn lg-btn-ghost lg-btn-sm"
          onClick={onFitView}
          disabled={fitViewDisabled}
        >
          适配视图
        </button>
      )}
    </div>
  );
}
