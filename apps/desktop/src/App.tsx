import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import '@listen-graphic/ui/styles/theme.css';

import type { ViewType } from '@listen-graphic/schema';
import { pickDefaultView, scoreViews } from '@listen-graphic/domain';
import {
  GraphArea,
  GraphNodeCard,
  GraphToolbar,
  SignalIndicator,
  SimpleLogPanel,
  StatusBar,
  ViewSwitcher,
  type GraphNodeCardData,
} from '@listen-graphic/ui';
import { DesktopRuntime, type AudioSourceKind } from './desktop-runtime';
import { getLayoutedElements } from './graph-layout';

function DesktopGraphNodeCard(props: NodeProps<GraphNodeCardData>) {
  return <GraphNodeCard {...props} handleMode="simple" />;
}

const nodeTypes = { graphNode: DesktopGraphNodeCard };

function formatAudioStatus(status: string) {
  if (status === 'starting') return '请求权限';
  if (status === 'capturing') return '采集中';
  if (status === 'ended') return '已结束';
  if (status === 'error') return '错误';
  return '空闲';
}

function formatLastFrame(timestamp: number | null) {
  if (!timestamp) return '无';
  return new Date(timestamp).toLocaleTimeString();
}

function formatLevel(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function levelToMeterPercent(rms: number, peak: number) {
  const level = Math.max(rms * 1.8, peak, 0.00001);
  const db = 20 * Math.log10(level);
  const percent = ((db + 60) / 54) * 100;
  const clamped = Math.max(0, Math.min(100, percent));
  return peak > 0.0005 ? Math.max(3, clamped) : 0;
}

export default function App() {
  const runtimeRef = useRef<DesktopRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = new DesktopRuntime();

  const [snapshot, setSnapshot] = useState(() => runtimeRef.current!.getSnapshot());
  const [currentView, setCurrentView] = useState<ViewType>('causal');

  useEffect(() => {
    return runtimeRef.current!.subscribe(setSnapshot);
  }, []);

  useEffect(() => {
    if (snapshot.graph.nodes.length === 0) return;
    setCurrentView((view) => view ?? pickDefaultView(snapshot.graph));
  }, [snapshot.graph]);

  const isRunning = snapshot.sessionState === 'capturing';
  const viewScores = useMemo(() => scoreViews(snapshot.graph), [snapshot.graph]);
  const { nodes, edges } = useMemo(
    () => getLayoutedElements(currentView, snapshot.graph),
    [currentView, snapshot.graph],
  );

  const handleSourceChange = (kind: AudioSourceKind) => {
    runtimeRef.current!.setAudioSourceKind(kind);
  };

  const handlePrimaryAction = () => {
    if (isRunning || snapshot.audioStatus === 'starting') {
      void runtimeRef.current!.stopSession();
    } else {
      void runtimeRef.current!.startSession();
    }
  };

  const audioLevelPercent = levelToMeterPercent(
    snapshot.audioLevel.rms,
    snapshot.audioLevel.peak,
  );
  const sourceLabel = snapshot.audioSourceKind === 'microphone' ? '麦克风' : '系统声音';

  return (
    <div className="desktop-shell" data-theme="dark">
      <GraphToolbar
        brandName="ListenGraph Desktop"
        primaryAction={{
          label: isRunning ? '停止' : '开始',
          onClick: handlePrimaryAction,
          active: isRunning,
        }}
        info={
          <div className="desktop-toolbar-info">
            <SignalIndicator active={isRunning} />
            <span>{window.listenGraphDesktop?.platform ?? 'desktop'}</span>
          </div>
        }
        actions={
          <>
            <fieldset className="desktop-source-picker" disabled={isRunning}>
              <legend>输入源</legend>
              <label>
                <input
                  type="radio"
                  name="audio-source"
                  checked={snapshot.audioSourceKind === 'microphone'}
                  onChange={() => handleSourceChange('microphone')}
                />
                麦克风
              </label>
              <label>
                <input
                  type="radio"
                  name="audio-source"
                  checked={snapshot.audioSourceKind === 'system'}
                  onChange={() => handleSourceChange('system')}
                />
                系统声音
              </label>
            </fieldset>
            <ViewSwitcher currentView={currentView} onViewChange={setCurrentView} />
          </>
        }
      />

      <main className="desktop-main">
        <section className="desktop-graph-pane">
          <GraphArea
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            isIdle={snapshot.sessionState === 'idle' && snapshot.graph.nodes.length === 0}
            onNodeClick={() => {}}
            fitView
          />
        </section>
        <aside className="desktop-log-pane">
          <div className="desktop-status-card">
            <div>
              <span>运行时</span>
              <strong>{snapshot.sessionState}</strong>
            </div>
            <div>
              <span>视图评分</span>
              <strong>{Math.round((viewScores[currentView] ?? 0) * 100)}</strong>
            </div>
          </div>
          <div className="desktop-audio-card">
            <div className="desktop-audio-card__header">
              <span>音频输入</span>
              <strong>{sourceLabel}</strong>
            </div>
            <div className="desktop-audio-meter" aria-label="音量">
              <span
                className={audioLevelPercent > 0 ? 'is-active' : undefined}
                style={{ width: `${audioLevelPercent}%` }}
              />
            </div>
            <dl className="desktop-audio-stats">
              <div>
                <dt>采集状态</dt>
                <dd>{formatAudioStatus(snapshot.audioStatus)}</dd>
              </div>
              <div>
                <dt>Frame</dt>
                <dd>{snapshot.frameCount}</dd>
              </div>
              <div>
                <dt>RMS</dt>
                <dd>{formatLevel(snapshot.audioLevel.rms)}</dd>
              </div>
              <div>
                <dt>Peak</dt>
                <dd>{formatLevel(snapshot.audioLevel.peak)}</dd>
              </div>
              <div>
                <dt>Sample rate</dt>
                <dd>{snapshot.sampleRate ? `${snapshot.sampleRate} Hz` : '无'}</dd>
              </div>
              <div>
                <dt>最后帧</dt>
                <dd>{formatLastFrame(snapshot.lastFrameAt)}</dd>
              </div>
            </dl>
            {snapshot.audioError ? (
              <div className="desktop-audio-error">{snapshot.audioError}</div>
            ) : null}
          </div>
          <SimpleLogPanel logs={snapshot.logs} placeholder="选择输入源后点击开始..." />
        </aside>
      </main>

      <StatusBar
        segments={[
          { id: 'session', content: `会话: ${snapshot.sessionId ?? '无'}` },
          {
            id: 'source',
            content: `输入: ${sourceLabel} | ${formatAudioStatus(snapshot.audioStatus)}`,
          },
          {
            id: 'stats',
            content: `节点: ${snapshot.graph.nodes.length} | 边: ${snapshot.graph.edges.length}`,
          },
        ]}
      />
    </div>
  );
}
