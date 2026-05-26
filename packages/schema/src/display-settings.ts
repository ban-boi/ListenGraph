export interface GraphDisplaySettings {
  autoFitMinReadableFontPx: 10 | 12 | 14 | 16;
}

export const DEFAULT_GRAPH_DISPLAY_SETTINGS: GraphDisplaySettings = {
  autoFitMinReadableFontPx: 12,
};

const ALLOWED_AUTO_FIT_FONT_SIZES: readonly number[] = [10, 12, 14, 16];

export function normalizeGraphDisplaySettings(
  settings: Partial<GraphDisplaySettings> | null | undefined,
): GraphDisplaySettings {
  const value = settings?.autoFitMinReadableFontPx;
  return {
    autoFitMinReadableFontPx:
      ALLOWED_AUTO_FIT_FONT_SIZES.includes(value ?? 0)
        ? value!
        : DEFAULT_GRAPH_DISPLAY_SETTINGS.autoFitMinReadableFontPx,
  };
}
