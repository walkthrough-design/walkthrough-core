import type { ElementEvidence, InteractionContext, Observation, Recording, Selection } from './index';

function state(element: ElementEvidence): 'open' | 'closed' | 'unknown' {
  const expanded = element.attributes?.['aria-expanded'];
  if (expanded === 'true' || element.states.includes('[aria-expanded="true"]')) return 'open';
  return expanded === 'false' ? 'closed' : 'unknown';
}

export function buildInteraction(recording: Recording, selection: Selection): InteractionContext | null {
  const selectedId = selection.element.nodeId;
  const paired = recording.observations.filter(item => item.panel && (item.element.nodeId === selectedId || item.panel.element.nodeId === selectedId || item.panel.structure?.nodes.some(node => node.nodeId === selectedId)));
  const nearest = paired.reduce<Observation | undefined>((best, item) => !best || Math.abs(item.at - selection.at) < Math.abs(best.at - selection.at) ? item : best, undefined);
  const manual = selection.linkedPanel;
  if (!manual && !nearest?.panel) return null;
  const trigger = manual ? selection.linkedTrigger ?? selection : { at: nearest!.at, element: nearest!.element, provenance: 'captured' as const };
  const history = recording.observations.filter(item => item.element.nodeId === trigger.element.nodeId).sort((a, b) => a.at - b.at);
  const openings = history.filter((item, index) => state(item.element) === 'open' && (index === 0 || state(history[index - 1]!.element) !== 'open'));
  const opening = openings.find(item => selection.at >= item.at && selection.at <= (history.find(next => next.at > item.at && state(next.element) === 'closed')?.at ?? recording.duration))
    ?? openings.reduce<Observation | undefined>((best, item) => !best || Math.abs(item.at - selection.at) < Math.abs(best.at - selection.at) ? item : best, undefined);
  const before = opening ? history.filter(item => item.at < opening.at && state(item.element) === 'closed').at(-1) : undefined;
  const after = opening ? history.find(item => item.at > opening.at && state(item.element) === 'closed') : undefined;
  const start = before?.at ?? opening?.at ?? history[0]?.at ?? selection.at;
  const end = after?.at ?? history.at(-1)?.at ?? selection.at;
  const candidates = manual ? [] : history.filter(item => item.panel?.targetId === nearest!.panel!.targetId);
  const inInterval = candidates.filter(item => item.at >= start && item.at <= end);
  const openPanels = inInterval.filter(item => state(item.element) === 'open');
  const panelSource = (openPanels.length ? openPanels : inInterval.length ? inInterval : candidates).reduce<Observation | undefined>((best, item) => !best || Math.abs(item.at - (opening?.at ?? selection.at)) < Math.abs(best.at - (opening?.at ?? selection.at)) ? item : best, undefined) ?? nearest;
  const panelElement = manual?.element ?? panelSource!.panel!.element;
  const structures = candidates.filter(item => item.panel!.element.nodeId === panelElement.nodeId && item.panel!.structure);
  const openStructures = structures.filter(item => item.at >= start && item.at <= end && state(item.element) === 'open');
  const structureSource = (openStructures.length ? openStructures : structures).reduce<Observation | undefined>((best, item) => !best || Math.abs(item.at - (opening?.at ?? selection.at)) < Math.abs(best.at - (opening?.at ?? selection.at)) ? item : best, undefined);
  const structure = manual?.structure ?? structureSource?.panel!.structure;
  const panelAt = manual?.at ?? panelSource!.at;
  const ids = new Set([trigger.element.nodeId, panelElement.nodeId, ...(structure?.nodes.map(node => node.nodeId) ?? [])]);
  const events = recording.observations.filter(item => ((item.at >= start && item.at <= end) || (item.eventAt !== undefined && item.eventAt >= start && item.eventAt <= end)) && (ids.has(item.element.nodeId) || item.key));
  const inputStart = Math.min(start, ...events.map(item => item.eventAt ?? item.at));
  const openPoint = opening && (history.find(item => item.at >= opening.at && item.at <= end && state(item.element) === 'open' && item.panel?.structure) ?? opening);
  const checkpoints = [before, openPoint, after].filter((item): item is Observation => !!item).map(item => ({ at: item.at, state: state(item.element), element: item.element, ...(item.panel ? { panel: item.panel.element } : {}) }));
  const gaps = ['Observed event order does not recover original event handlers or prove causality.', 'External fonts/images and SVG/canvas shapes are not included in the structure reference; child-node animation and unvisited states may be unknown.'];
  if (!before) gaps.push('A closed state before opening was not observed.');
  if (!opening) gaps.push('An expanded open state was not observed.');
  if (!after) gaps.push('A closed state after opening was not observed.');
  if (!structure) gaps.push('Panel structure was not captured.');
  else if (structure.truncated) gaps.push('Panel structure exceeds the bounded capture; omitted nodes/text are unknown.');
  if (!events.some(item => item.key)) gaps.push('No identified control key was captured for this interval.');
  if (!after?.element.states.includes(':focus') && !events.some(item => item.trigger === 'focusin' && item.element.nodeId === trigger.element.nodeId && item.at >= (after?.at ?? Infinity))) gaps.push('Focus on the trigger after closing was not observed.');
  return {
    trigger: selectedId === trigger.element.nodeId ? { at: selection.at, element: selection.element, provenance: selection.provenance } : { at: trigger.at, element: trigger.element, provenance: trigger.provenance },
    panel: { at: selectedId === panelElement.nodeId ? selection.at : panelAt, element: selectedId === panelElement.nodeId ? selection.element : panelElement, provenance: selectedId === panelElement.nodeId ? selection.provenance : manual?.provenance ?? 'captured', ...(structure ? { structure, structureAt: manual?.at ?? structureSource!.at, structureProvenance: manual?.provenance ?? 'captured' } : {}) },
    relation: manual ? { type: 'user-selected', provenance: 'user-selected' } : { type: panelSource!.panel!.relation, targetId: panelSource!.panel!.targetId, provenance: 'captured' },
    interval: { start: inputStart, end }, checkpoints, events, gaps,
  };
}
