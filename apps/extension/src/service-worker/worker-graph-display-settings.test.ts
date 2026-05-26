import { describe, it, expect } from 'vitest';
import {
  normalizeGraphDisplaySettings,
  handleGetGraphDisplaySettings,
  handleSaveGraphDisplaySettings,
  DEFAULT_GRAPH_DISPLAY_SETTINGS,
} from './graph-display-settings';
import type { GraphDisplaySettings } from '../shared/messages';

describe('graph-display-settings', () => {
  describe('normalizeGraphDisplaySettings', () => {
    it('对空值返回默认设置', () => {
      expect(normalizeGraphDisplaySettings(null)).toEqual(DEFAULT_GRAPH_DISPLAY_SETTINGS);
      expect(normalizeGraphDisplaySettings(undefined)).toEqual(DEFAULT_GRAPH_DISPLAY_SETTINGS);
      expect(normalizeGraphDisplaySettings({})).toEqual(DEFAULT_GRAPH_DISPLAY_SETTINGS);
    });

    it('保留有效的字号值', () => {
      expect(normalizeGraphDisplaySettings({ autoFitMinReadableFontPx: 10 }))
        .toEqual({ autoFitMinReadableFontPx: 10 });
      expect(normalizeGraphDisplaySettings({ autoFitMinReadableFontPx: 16 }))
        .toEqual({ autoFitMinReadableFontPx: 16 });
    });

    it('对无效值回退到默认', () => {
      expect(normalizeGraphDisplaySettings({ autoFitMinReadableFontPx: 11 } as any))
        .toEqual(DEFAULT_GRAPH_DISPLAY_SETTINGS);
      expect(normalizeGraphDisplaySettings({ autoFitMinReadableFontPx: 0 } as any))
        .toEqual(DEFAULT_GRAPH_DISPLAY_SETTINGS);
    });
  });

  describe('handleGetGraphDisplaySettings', () => {
    it('无已存设置时返回默认值', async () => {
      const response = await handleGetGraphDisplaySettings({
        settingsRepository: {
          getGraphDisplaySettings: async () => null,
          saveGraphDisplaySettings: async () => {},
        },
      });

      expect(response).toMatchObject({
        success: true,
        graphDisplaySettings: { autoFitMinReadableFontPx: 12 },
      });
    });

    it('返回已存的归一化设置', async () => {
      const response = await handleGetGraphDisplaySettings({
        settingsRepository: {
          getGraphDisplaySettings: async () => ({ autoFitMinReadableFontPx: 14 }),
          saveGraphDisplaySettings: async () => {},
        },
      });

      expect(response).toMatchObject({
        success: true,
        graphDisplaySettings: { autoFitMinReadableFontPx: 14 },
      });
    });
  });

  describe('handleSaveGraphDisplaySettings', () => {
    it('保存有效设置并返回归一化结果', async () => {
      let savedSettings: GraphDisplaySettings | undefined;
      const response = await handleSaveGraphDisplaySettings(
        { autoFitMinReadableFontPx: 16 },
        {
          settingsRepository: {
            getGraphDisplaySettings: async () => null,
            saveGraphDisplaySettings: async (settings) => { savedSettings = settings; },
          },
        },
      );

      expect(response).toMatchObject({
        success: true,
        graphDisplaySettings: { autoFitMinReadableFontPx: 16 },
      });
      expect(savedSettings).toEqual({ autoFitMinReadableFontPx: 16 });
    });

    it('对无效值进行归一化后保存', async () => {
      let savedSettings: GraphDisplaySettings | undefined;
      const response = await handleSaveGraphDisplaySettings(
        { autoFitMinReadableFontPx: 99 } as any,
        {
          settingsRepository: {
            getGraphDisplaySettings: async () => null,
            saveGraphDisplaySettings: async (settings) => { savedSettings = settings; },
          },
        },
      );

      expect(response).toMatchObject({
        success: true,
        graphDisplaySettings: { autoFitMinReadableFontPx: 12 },
      });
      expect(savedSettings).toEqual({ autoFitMinReadableFontPx: 12 });
    });
  });
});
