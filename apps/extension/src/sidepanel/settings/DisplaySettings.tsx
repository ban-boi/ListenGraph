// ---------------------------------------------------------------------------
// DisplaySettings —— 「显示」Tab 页内容组件
// 提取自 SettingsPanel.tsx 中「图谱显示」部分，使用 FormControls + theme
// ---------------------------------------------------------------------------

import type { GraphDisplaySettings } from '@listen-graphic/schema';
import { LabeledField, SectionHeader, SelectField } from '@listen-graphic/ui';
import { spacing, hintTextStyle } from './theme';

// ── 类型 ──────────────────────────────────────────────────────────────────

export type DisplaySettingsProps = {
  settings: GraphDisplaySettings;
  onUpdateAutoFitMinReadableFontPx: (value: string) => void;
};

// ── 组件 ──────────────────────────────────────────────────────────────────

export function DisplaySettings({
  settings,
  onUpdateAutoFitMinReadableFontPx,
}: DisplaySettingsProps) {
  return (
    <div style={{ display: 'grid', gap: spacing.fieldGap }}>
      <SectionHeader>图谱显示</SectionHeader>

      <LabeledField label="自动适配最小字号">
        <SelectField
          ariaLabel="自动适配最小字号"
          value={String(settings.autoFitMinReadableFontPx)}
          onChange={onUpdateAutoFitMinReadableFontPx}
        >
          <option value="10">10px</option>
          <option value="12">12px</option>
          <option value="14">14px</option>
          <option value="16">16px</option>
        </SelectField>
      </LabeledField>

      <div style={hintTextStyle}>
        只影响首次自动适配和手动适配视图；鼠标滚轮、触控板和 React Flow
        控件缩放不受限制。
      </div>
    </div>
  );
}
