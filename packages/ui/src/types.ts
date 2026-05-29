export type GraphNodeDisplayMode = 'readable' | 'compact';

export type GraphNodeHandleMode = 'simple' | 'multi';

export interface GraphNodeCardData {
  label: string;
  nodeType: string;
  speaker?: string;
  timestampMs: number;
  status: 'draft' | 'confirmed';
  isActive: boolean;
  displayMode?: GraphNodeDisplayMode;
  isTourAnchor?: boolean;
  isTourAdded?: boolean;
  onClickTime: (ms: number) => void;
}
