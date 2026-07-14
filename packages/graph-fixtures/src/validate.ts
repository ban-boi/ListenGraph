import type { MergedGraph } from '@listen-graphic/schema';

import { loadManifest, loadSequence } from './load';
import { regressionCaseSchema, sequenceFixtureSchema } from './schemas';
import type { RegressionCase, SequenceFixture, ValidationReport } from './types';

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

/**
 * 校验回归 case：schema + trigger ID 引用完整性 + status/baseline 一致性。
 */
export function validateRegressionCase(fixture: unknown): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = regressionCaseSchema.safeParse(fixture);
  if (!parsed.success) {
    return { ok: false, errors: [parsed.error.message], warnings };
  }

  const testCase: RegressionCase = parsed.data;
  const nodes = nodeIds(testCase.graph);
  const edges = edgeIds(testCase.graph);

  for (const nodeId of testCase.triggeringNodeIds ?? []) {
    if (!nodes.has(nodeId)) {
      errors.push(`Regression ${testCase.id}: triggeringNodeId not in graph: ${nodeId}`);
    }
  }
  for (const edgeId of testCase.triggeringEdgeIds ?? []) {
    if (!edges.has(edgeId)) {
      errors.push(`Regression ${testCase.id}: triggeringEdgeId not in graph: ${edgeId}`);
    }
  }

  if (testCase.status === 'baselined' && !testCase.softBaselines) {
    errors.push(`Regression ${testCase.id}: baselined case requires softBaselines`);
  }
  if (testCase.status === 'candidate' && testCase.softBaselines) {
    warnings.push(`Regression ${testCase.id}: candidate case unexpectedly has softBaselines`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 检查一组 fixture id 是否唯一（可跨 sequence / snapshot / regression 集合）。
 */
export function assertUniqueFixtureIds(
  collections: Array<{ label: string; ids: string[] }>,
): ValidationReport {
  const errors: string[] = [];
  const seen = new Map<string, string>();

  for (const collection of collections) {
    for (const id of collection.ids) {
      const prior = seen.get(id);
      if (prior) {
        errors.push(`Duplicate fixture id "${id}" in ${prior} and ${collection.label}`);
      } else {
        seen.set(id, collection.label);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings: [] };
}

export function validateAllFixtures(
  extraRegressionCases: unknown[] = [],
): ValidationReport {
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

  const sequenceIds: string[] = [];
  for (const entry of loadManifest().sequences) {
    sequenceIds.push(entry.id);
    try {
      const fixture = loadSequence(entry.id);
      const report = validateSequence(fixture);
      errors.push(...report.errors);
      warnings.push(...report.warnings);
    } catch (error) {
      errors.push(`Failed to load sequence ${entry.id}: ${String(error)}`);
    }
  }

  const snapshotIds = loadManifest().snapshots.map((entry) => entry.id);
  const regressionIds: string[] = [];
  for (const [index, raw] of extraRegressionCases.entries()) {
    const report = validateRegressionCase(raw);
    errors.push(...report.errors);
    warnings.push(...report.warnings);
    const parsed = regressionCaseSchema.safeParse(raw);
    if (parsed.success) {
      regressionIds.push(parsed.data.id);
    } else {
      regressionIds.push(`invalid-regression-${index}`);
    }
  }

  const uniqueness = assertUniqueFixtureIds([
    { label: 'sequences', ids: sequenceIds },
    { label: 'snapshots', ids: snapshotIds },
    { label: 'regression', ids: regressionIds },
  ]);
  errors.push(...uniqueness.errors);

  return { ok: errors.length === 0, errors, warnings };
}

export type { SequenceFixture };
