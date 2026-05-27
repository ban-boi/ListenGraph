import type { ProviderConfig, ProviderRuntimeSummary, GraphDisplaySettings } from '@listen-graphic/schema';
import type { BridgeHealth } from './panel-reducer';
import { SettingsOverlay } from './settings/SettingsOverlay';

type SaveResult = { ok: true } | { ok: false; error: string };

export type SettingsPanelProps = {
  providerConfig: ProviderConfig;
  providerSummary: ProviderRuntimeSummary;
  settingsSaving: boolean;
  bridgeHealth: BridgeHealth;
  graphDisplaySettings: GraphDisplaySettings;
  isDirty: boolean;
  onUpdateProviderEntry: (
    stage: keyof ProviderConfig,
    field: keyof ProviderConfig['asr'],
    value: string,
  ) => void;
  onProviderTypeChange: (stage: keyof ProviderConfig, nextType: string) => void;
  onUpdateAutoFitMinReadableFontPx: (value: string) => void;
  onSaveSettings: () => Promise<SaveResult>;
  onClearSecrets: () => void;
  onClose: () => void;
};

export function SettingsPanel(props: SettingsPanelProps) {
  return <SettingsOverlay {...props} />;
}
