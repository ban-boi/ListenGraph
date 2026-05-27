import { useCallback, useEffect, useMemo, useState } from 'react';

import type { MergedGraph } from '@listen-graphic/schema';
import type { SequenceFixture } from '@listen-graphic/graph-fixtures/types';

import seqIncremental from '../../../packages/graph-fixtures/fixtures/sequences/seq-incremental-growth.json';
import seqLateBurst from '../../../packages/graph-fixtures/fixtures/sequences/seq-late-burst.json';
import seqViewSwitchMid from '../../../packages/graph-fixtures/fixtures/sequences/seq-view-switch-mid.json';

const SEQUENCE_MAP: Record<string, SequenceFixture> = {
  'seq-incremental-growth': seqIncremental as SequenceFixture,
  'seq-late-burst': seqLateBurst as SequenceFixture,
  'seq-view-switch-mid': seqViewSwitchMid as SequenceFixture,
};

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function readSequenceIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('sequence');
}

export type GraphFixtureSequenceState = {
  active: boolean;
  sequenceId: string | null;
  graph: MergedGraph | null;
  stepIndex: number;
  total: number;
  error: string | null;
};

export function useGraphFixtureSequence(): GraphFixtureSequenceState {
  const sequenceId = useMemo(() => readSequenceIdFromLocation(), []);

  const [sequence, setSequence] = useState<SequenceFixture | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sequenceId) {
      setSequence(null);
      setStepIndex(0);
      setError(null);
      return;
    }

    const fixture = SEQUENCE_MAP[sequenceId];
    if (!fixture) {
      setSequence(null);
      setStepIndex(0);
      setError(`Unknown sequence: ${sequenceId}`);
      return;
    }

    setSequence(fixture);
    setStepIndex(0);
    setError(null);
  }, [sequenceId]);

  const goNext = useCallback(() => {
    if (!sequence) return;
    setStepIndex((index) => Math.min(index + 1, sequence.steps.length - 1));
  }, [sequence]);

  const goPrev = useCallback(() => {
    setStepIndex((index) => Math.max(index - 1, 0));
  }, []);

  useEffect(() => {
    if (!sequence) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sequence, goNext, goPrev]);

  const graph = sequence?.steps[stepIndex]?.graph ?? null;

  return {
    active: Boolean(sequenceId && sequence && graph),
    sequenceId,
    graph,
    stepIndex,
    total: sequence?.steps.length ?? 0,
    error,
  };
}
