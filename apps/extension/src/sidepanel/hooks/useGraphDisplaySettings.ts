import { useCallback, useRef, useState } from 'react';
import { normalizeGraphDisplaySettings, DEFAULT_GRAPH_DISPLAY_SETTINGS } from '@listen-graphic/schema';
import type { GraphDisplaySettings } from '@listen-graphic/schema';
import type { AppMessage } from '../../shared/messages';

interface UseGraphDisplaySettingsOptions {
  addLog: (msg: string) => void;
}

export function useGraphDisplaySettings({
  addLog,
}: UseGraphDisplaySettingsOptions) {
  const [graphDisplaySettings, setGraphDisplaySettings] =
    useState<GraphDisplaySettings>(DEFAULT_GRAPH_DISPLAY_SETTINGS);
  const [graphDisplaySettingsSaving, setGraphDisplaySettingsSaving] =
    useState(false);

  // 用 ref 持有最新值，避免 saveGraphDisplaySettings 的陈旧闭包
  const graphDisplaySettingsRef = useRef(graphDisplaySettings);
  graphDisplaySettingsRef.current = graphDisplaySettings;

  // dirty 追踪：记录最近一次已保存（或已加载）的快照
  const initialDisplayRef = useRef<GraphDisplaySettings | null>(null);

  const loadGraphDisplaySettings = useCallback(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_GRAPH_DISPLAY_SETTINGS',
        target: 'service-worker',
        payload: {},
      } as AppMessage)) as
        | { success: true; graphDisplaySettings?: GraphDisplaySettings }
        | { success: false; error?: string };

      if (!response?.success) {
        addLog(`加载图谱显示设置失败: ${response?.error || '未知错误'}`);
        return;
      }

      const loaded = normalizeGraphDisplaySettings(response.graphDisplaySettings);
      setGraphDisplaySettings(loaded);
      initialDisplayRef.current = loaded;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '读取图谱显示设置失败';
      addLog(`加载图谱显示设置失败: ${message}`);
    }
  }, [addLog]);

  const updateAutoFitMinReadableFontPx = useCallback((value: string) => {
    const numericValue = Number(value);
    setGraphDisplaySettings(
      normalizeGraphDisplaySettings({
        autoFitMinReadableFontPx: numericValue as GraphDisplaySettings['autoFitMinReadableFontPx'],
      }),
    );
  }, []);

  type SaveResult = { ok: true } | { ok: false; error: string };

  const saveGraphDisplaySettings = useCallback(async (): Promise<SaveResult> => {
    setGraphDisplaySettingsSaving(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'SAVE_GRAPH_DISPLAY_SETTINGS',
        target: 'service-worker',
        payload: {
          settings: graphDisplaySettingsRef.current,
        },
      } as AppMessage)) as
        | { success: true; graphDisplaySettings?: GraphDisplaySettings }
        | { success: false; error?: string };

      if (!response?.success) {
        const error = response?.error || '未知错误';
        addLog(`保存图谱显示设置失败: ${error}`);
        return { ok: false, error };
      }

      const saved = normalizeGraphDisplaySettings(response.graphDisplaySettings);
      setGraphDisplaySettings(saved);
      initialDisplayRef.current = saved; // 更新快照，清除 dirty
      addLog('图谱显示设置已保存');
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '保存图谱显示设置失败';
      addLog(`保存图谱显示设置失败: ${message}`);
      return { ok: false, error: message };
    } finally {
      setGraphDisplaySettingsSaving(false);
    }
  }, [addLog]);

  return {
    graphDisplaySettings,
    graphDisplaySettingsSaving,
    loadGraphDisplaySettings,
    updateAutoFitMinReadableFontPx,
    saveGraphDisplaySettings,
    initialDisplayRef,
  };
}
