# LLM Judge First Batch Summary

Generated: 2026-06-17 22:15

Scope:
- Source: local ASR artifact segments from `local_full_3_冲突争论型_黄执中周玄毅哲理辩.utterances.json`
- Segments evaluated: `seg14`, `seg18`, `seg31`, `seg33`, `seg38`, `seg43`
- Graph A: with Structure Unit Assembler
- Graph B: without Structure Unit Assembler
- Judge model: `qwen3.6-plus-2026-04-02`

## Result Table

| Seg | Graph A nodes/edges | Graph B nodes/edges | Coverage A/B | Faith A/B | Rel A/B | Noise A/B | Preferred | Promote? | Draft min/max nodes | Draft min edges |
|-----|---------------------|---------------------|--------------|-----------|---------|-----------|-----------|----------|---------------------|-----------------|
| seg14 | 12/11 | 11/10 | 5/4 | 4/4 | 3/3 | 5/5 | graphA | yes | 10/15 | 8 |
| seg18 | 17/17 | 18/18 | 5/5 | 5/5 | 5/5 | 5/5 | graphB | yes | 15/20 | 15 |
| seg31 | 12/10 | 11/11 | 5/5 | 5/5 | 3/4 | 5/5 | graphB | yes | 9/14 | 7 |
| seg33 | 14/12 | 14/14 | 5/5 | 5/5 | 4/4 | 5/5 | graphA | yes | 10/18 | 10 |
| seg38 | 13/11 | 11/10 | 5/4 | 5/4 | 4/4 | 5/5 | graphA | yes | 10/15 | 8 |
| seg43 | 17/17 | 14/13 | 5/5 | 5/5 | 4/4 | 5/5 | graphB | yes | 10/18 | 10 |

## Batch-Level Readout

- All 6 evaluated segments were marked `shouldPromoteToFixture: true`.
- Preference split is even: Graph A won 3, Graph B won 3.
- Assembler is not clearly better or worse from this small batch alone.
- Both paths generally preserve coverage and faithfulness well.
- The main differentiator is relation quality, especially whether the graph keeps oppositional or causal structure clean without over-fragmenting.

## Candidate Fixture Priorities

High-priority candidates:
- `seg18`: strongest full-score segment; contains question, rebuttal, reason, example, and comparison.
- `seg43`: good for advice/response/coping structure and noise filtering.
- `seg31`: useful because relation quality differs between A and B.
- `seg14`: useful because assembler wins on coverage.

Secondary candidates:
- `seg33`: good problem-discovery segment, but both outputs are close.
- `seg38`: useful value-judgment segment, with assembler preferred.

## Next Manual Calibration Pass

For each promoted fixture:
- Keep `mustContainOneOfTexts` groups from the judgment draft, but shorten over-specific synonyms.
- Keep `minMergedNodes`, `maxMergedNodes`, and `minMergedEdges` as soft ranges.
- Keep `mustHaveNodeTypes` minimal, usually `claim`; add `question`, `reason`, or `example` only when the segment clearly requires them.
- Do not add `requiredEdgeTypes` unless the relation is unambiguous and central.
- Set `allowFallback: false` after confirming the selected fixture is stable under the current model.
- Remove `_quality: "weak_scaffold"` only after manual review.
