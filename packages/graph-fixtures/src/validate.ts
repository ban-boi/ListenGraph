import type { MergedGraph } from '@listen-graphic/schema';

import { loadManifest, loadSequence } from './load';
import { sequenceFixtureSchema } from './schemas';
import type { SequenceFixture, ValidationReport } from './types';

function nodeIds(graph: MergedGraph): Set<string> {
  return new Set(graph.nodes.map((node) => node.id));
}

function edgeIds(graph: MergedGraph): Set<string> {
  return new Set(graph.edges.map((edge) => edge.id));
}

function isSubset(subset: Set<string>, superset: Set<string>): boolean {
  for (const id of subset) {
    if (!superset.has(id)) {
      return false;
    }
  }
  return true;
}

export function validateSequence(fixture: unknown): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = sequenceFixtureSchema.safeParse(fixture);
  if (!parsed.success) {
    return { ok: false, errors: [parsed.error.message], warnings };
  }

  const sequence = parsed.data;

  if (sequence.steps.length < 2) {
    errors.push(
      `Sequence ${sequence.id}: steps.length must be >= 2, got ${sequence.steps.length}`,
    );
  }

  for (let index = 0; index < sequence.steps.length; index += 1) {
    const step = sequence.steps[index];
    const graph = step.graph;

    if (graph.sessionId !== sequence.sessionId) {
      errors.push(
        `Sequence ${sequence.id} step ${index}: graph.sessionId (${graph.sessionId}) !== fixture.sessionId (${sequence.sessionId})`,
      );
    }

    if (index === 0) {
      continue;
    }

    const previousGraph = sequence.steps[index - 1].graph;

    if (graph.revision <= previousGraph.revision) {
      errors.push(
        `Sequence ${sequence.id} step ${index}: revision ${graph.revision} must be > ${previousGraph.revision}`,
      );
    }

    if (!isSubset(nodeIds(previousGraph), nodeIds(graph))) {
      errors.push(
        `Sequence ${sequence.id} step ${index}: node ids not monotonic (subset of next step)`,
      );
    }

    if (!isSubset(edgeIds(previousGraph), edgeIds(graph))) {
      errors.push(
        `Sequence ${sequence.id} step ${index}: edge ids not monotonic (subset of next step)`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateAllFixtures(): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    loadManifest();
  } catch (error) {
    return {
      ok: false,
      errors: [`Failed to load manifest: ${String(error)}`],
      warnings,
    };
  }

  for (const entry of loadManifest().sequences) {
    try {
      const fixture = loadSequence(entry.id);
      const report = validateSequence(fixture);
      errors.push(...report.errors);
      warnings.push(...report.warnings);
    } catch (error) {
      errors.push(`Failed to load sequence ${entry.id}: ${String(error)}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export type { SequenceFixture };
