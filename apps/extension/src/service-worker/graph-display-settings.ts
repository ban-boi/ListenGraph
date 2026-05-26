import { normalizeGraphDisplaySettings, DEFAULT_GRAPH_DISPLAY_SETTINGS } from '@listen-graphic/schema';
import type { GraphDisplaySettings } from '@listen-graphic/schema';
import type { ServiceWorkerResponse } from './sw-types';

export { normalizeGraphDisplaySettings, DEFAULT_GRAPH_DISPLAY_SETTINGS };

export interface GraphDisplaySettingsDeps {
  settingsRepository: {
    getGraphDisplaySettings(): Promise<GraphDisplaySettings | null | undefined>;
    saveGraphDisplaySettings(settings: GraphDisplaySettings): Promise<void>;
  };
}

export async function handleGetGraphDisplaySettings(
  deps: GraphDisplaySettingsDeps,
): Promise<ServiceWorkerResponse> {
  const storedSettings = await deps.settingsRepository.getGraphDisplaySettings();
  return {
    success: true,
    graphDisplaySettings: normalizeGraphDisplaySettings(storedSettings),
  };
}

export async function handleSaveGraphDisplaySettings(
  settings: GraphDisplaySettings,
  deps: GraphDisplaySettingsDeps,
): Promise<ServiceWorkerResponse> {
  const normalized = normalizeGraphDisplaySettings(settings);
  await deps.settingsRepository.saveGraphDisplaySettings(normalized);
  return {
    success: true,
    graphDisplaySettings: normalized,
  };
}
