# Two-Stage Auto Tour Design

## Purpose

ListenGraph grows continuously during a live session. As the graph grows, the sidepanel needs to keep users oriented around newly generated nodes and edges without forcing them to read the whole graph at once.

This design replaces a fixed "latest N nodes" auto-follow rule with a two-stage auto tour for each structurer graph update:

1. Reveal the structure of the current increment.
2. Focus on readable content for the new nodes.

The design does not introduce topic detection, global relayout, dagre, elk, or large-graph aggregation in the first version.

## Context

Current sidepanel behavior prioritizes incremental stability:

- Existing node positions are reused through a layout cache.
- The viewport should not be stolen after every graph update.
- Auto-tour already has concepts for added nodes, anchor nodes, user interaction cooldown, and batched reveal.
- Graph display settings are being extended with a minimum readable font size for automatic fit operations.

The new behavior should build on those existing constraints rather than replacing the graph layout system.

## Goals

- Let users see the rough structure created by each structurer update.
- Let users read newly generated node content at the configured minimum readable font size.
- Avoid depending on topic/business logic that does not exist yet.
- Preserve manual user control: pan, zoom, or node interaction pauses the tour temporarily.
- Queue consecutive graph updates rather than merging them into one larger update.
- Keep first-version implementation bounded and testable.

## Non-Goals

- No topic frontier logic.
- No dagre or elk layout engine integration.
- No full graph relayout on every update.
- No special aggregation for unusually large updates such as 20+ added nodes.
- No persistent node coordinate storage.
- No requirement to make every historical node readable during live capture.

## Core Interaction Model

Each `MERGED_GRAPH_UPDATED` event may enqueue one auto-tour unit. A tour unit has up to two stages.

### Stage 1: Structure Reveal

The structure reveal briefly frames:

- the nodes added in the current graph update;
- valid old anchor nodes that are directly connected to those new nodes;
- edges among the new nodes;
- edges between new nodes and valid old anchors.

This stage is for orientation, not full reading. It should be short, roughly 800-1500 ms of camera movement plus a brief dwell. Compact node rendering is allowed here because the goal is to understand the local structure, not read complete node text.

Stage 1 is skipped when both conditions are true:

- the update has no valid old anchor connected to added nodes;
- the added nodes do not have any visible edge to another added node.

This handles likely new-topic starts or isolated additions without pulling unrelated historical nodes into view.

### Stage 2: Reading Focus

The reading focus frames added nodes only. Old anchors are not included just to fill space.

The number of nodes per reading batch is not fixed. The first version should estimate how many added nodes can fit at the current container size while preserving the configured minimum readable font size. If all added nodes fit, the tour has one reading batch. If they do not fit, it splits them into multiple batches, similar to the existing auto-tour behavior.

### User Interruptions

Manual pan, zoom, or node interaction pauses the tour. If the user stops interacting, the system resumes after a longer cooldown, with a default around 7000 ms. Additional interaction resets the cooldown.

The tour queue is preserved during the pause.

### Consecutive Updates

Consecutive graph updates are queued rather than merged. This avoids producing one oversized reveal from multiple structurer updates and keeps each tour unit tied to a specific increment.

## Data Selection Rules

The first version should rely on data already available in sidepanel graph update handling.

### Added Nodes

`addedNodeIds` defines the nodes that belong to the current update.

Stage 2 reads only these nodes. It does not pull in older isolated nodes, even if there is empty viewport space.

### Valid Anchors

`anchorNodeIds` are candidates for structure context. A candidate anchor is valid only if there is a real edge connecting it to at least one added node.

Anchors are relationship context, not historical context. If an anchor candidate has no edge to the current added nodes, it should be ignored.

### Internal Added Edges

Edges among added nodes are included in Stage 1. If there are internal added edges, Stage 1 may run even without old anchors.

This supports future structures such as one question node connected to several child point nodes, without adding topic logic.

### Stage Edge Rules

Stage 1 includes:

- edges among added nodes;
- edges between added nodes and valid anchors.

Stage 2 includes:

- edges among added nodes in the current reading batch;
- optionally muted or hidden edges to added nodes outside the current batch.

Stage 2 should not include old anchor nodes by default.

## Viewport And Readable Capacity

Automatic tour camera movement should use `fitBounds` or equivalent system-triggered viewport operations. Manual zoom remains unrestricted by readable font settings.

### Stage 1 Viewport

Stage 1 bounds are computed from the compact structure reveal nodes:

- added nodes;
- valid anchors;
- selected Stage 1 edges.

The compact bounds estimate should not use the full reading card size. It should use the compact display dimensions once those exist, or conservative constants in the first implementation.

### Stage 2 Viewport

Stage 2 computes readable batches with an estimated capacity:

1. Order added nodes by the current renderer graph's stable node order for the active view.
2. Estimate readable node dimensions using existing layout constants or conservative card dimensions.
3. Use container width and height plus `autoFitMinReadableFontPx` to derive a minimum automatic-fit zoom.
4. Add consecutive nodes to the batch while the estimated bounds remain readable.
5. Split into additional batches when necessary.

The first implementation may use estimated sizes from current constants such as `STABLE_LAYOUT_CARD_WIDTH`, `STABLE_LAYOUT_CARD_HEIGHT`, row gap, and branch gap. If real behavior diverges too much, a later iteration can use measured DOM bounds.

## Node Visual Modes

The same graph node component should support display modes so structure reveal and reading focus can serve different jobs.

### Compact Mode

Compact mode is used in Stage 1.

It should:

- reduce padding;
- show at most 1-2 lines of text;
- keep type color visible;
- show secondary metadata such as speaker, time, and draft status as smaller badges or muted details;
- render valid anchor nodes more muted than added nodes;
- mark added nodes clearly, for example with highlight styling or a "new" indicator.

Compact mode must not rely on shrinking text below the configured readability intent. It should reduce non-text area and hide secondary information instead.

### Readable Mode

Readable mode is used in Stage 2.

The first version can continue using the current `GraphNodeCard` shape, with only minimal changes needed to support mode switching. If reading batches still cannot fit well, a later iteration can mildly compress readable mode with fewer metadata rows or truncation.

## Implementation Shape

Likely sidepanel code changes:

- `useAutoTour.ts`: change from immediate single-seed playback to a queue of two-stage tour units.
- `auto-tour-utils.ts`: add utilities for valid anchor filtering, structure reveal decision-making, Stage 1 bounds, and readable batch estimation.
- `types.ts`: extend node data with a display mode such as `displayMode: 'compact' | 'readable'` and possibly current-tour membership flags.
- `GraphNodeCard.tsx`: render compact/readable variants based on `displayMode`.
- `App.tsx`: pass graph display settings into auto-tour so readable batch capacity can account for `autoFitMinReadableFontPx`.
- Tests: focus on pure tour utilities first, then sidepanel behavior around graph updates and user interruption.

## Test Strategy

Pure utility tests should cover:

- valid anchors include only old nodes directly connected to added nodes;
- structure reveal is skipped when there are no valid anchors and no internal added edges;
- structure reveal is generated when added nodes have internal edges, even without old anchors;
- Stage 1 edge filtering includes only added-added and added-anchor edges;
- Stage 2 batches use only added nodes;
- Stage 2 splits added nodes when estimated readable capacity is exceeded;
- consecutive updates create separate queue items rather than merging.

UI or hook tests should cover:

- a graph update with valid anchors plays structure reveal before reading focus;
- a graph update without valid anchors or internal added edges skips structure reveal;
- manual viewport movement pauses playback and resumes after the configured delay;
- `autoFitMinReadableFontPx` changes reading batch capacity;
- Stage 1 nodes render compact while Stage 2 nodes render readable.

## Open Parameters

The first version should use conservative defaults:

- structure reveal camera duration: 800-1500 ms;
- resume delay after manual interaction: about 7000 ms;
- readable capacity: estimated from current card/layout constants;
- oversized updates: no special handling in v1.

These should be constants that can be tuned after real use.

## Rationale

The design solves the original readability tension by separating structure and reading:

- A growing graph no longer requires the whole topology to remain readable.
- Stage 1 gives users a quick structural orientation around each increment.
- Stage 2 makes new content readable under the minimum font constraint.
- Old graph context appears only when it has a real edge to the new increment.
- The system stays independent of topic logic and avoids global relayout.

This also leaves room for future semantic layout improvements. If structurer output later creates stronger structures such as a question with several child points, Stage 1 can reveal that local subgraph without changing the overall interaction model.
