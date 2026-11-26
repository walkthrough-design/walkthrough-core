import type { Observation, Recording } from './index';

export interface ReplayStep { at: number; label: string; kind: 'click' | 'key' | 'state' | 'change' | 'hover'; observation: Observation }

export function initialReplayTime(recording: Recording): number {
  const snapshot = recording.events.find(event => event.type === 2);
  if (!snapshot) return 0;
  let ready;
  for (let index = recording.events.indexOf(snapshot) + 1; index < recording.events.length; index++) {
    const event = recording.events[index]!;
    if (event.type === 2 || event.type === 4) break;
    if (event.type === 5 && event.data.tag === 'walkthrough:ready') { ready = event; break; }
  }
  // The marker includes deferred initial styles; older files fall back to the snapshot.
  return Math.min(recording.duration, (ready?.timestamp ?? snapshot.timestamp) - recording.events[0]!.timestamp + 1);
}

export function getReplaySteps(recording: Recording): ReplayStep[] {
  const inputs = new Map<string, Observation>();
  const states = new Map<number, string>();
  const steps: ReplayStep[] = [];
  const name = (item: Observation) => (item.element.label || item.element.tag).slice(0, 90);
  const priority = (item: Observation) => item.panel ? 3 : item.element.attributes?.['aria-expanded'] !== undefined ? 2 : item.element.tag === 'button' || item.element.attributes?.role === 'button' ? 1 : 0;
  for (const [index, item] of recording.observations.entries()) {
    if (item.trigger === 'initial-state' || item.trigger === 'state-change') {
      const attributes = item.element.attributes ?? {};
      const signature = JSON.stringify([attributes['aria-expanded'], attributes['data-state'], attributes.open, item.panel?.element.styles.display, item.panel?.element.styles.visibility]);
      const previous = states.get(item.element.nodeId);
      states.set(item.element.nodeId, signature);
      if (item.trigger === 'initial-state' || previous === signature) continue;
      const state = attributes['aria-expanded'] === 'true' ? 'Opened' : attributes['aria-expanded'] === 'false' ? 'Closed' : 'State changed';
      steps.push({ at: item.at, kind: 'state', label: `${state} · ${name(item)}`, observation: item });
      continue;
    }
    if (!['click', 'keydown', 'change', 'pointerover'].includes(item.trigger) || item.trigger === 'keydown' && !item.key || item.trigger === 'pointerover' && !item.panel) continue;
    // The recorder keeps a child and its control; show one step for the same input.
    const key = item.eventAt === undefined ? `legacy:${index}` : `${item.trigger}:${item.eventAt}`;
    const previous = inputs.get(key);
    if (!previous || priority(item) > priority(previous)) inputs.set(key, item);
  }
  for (const item of inputs.values()) {
    const kind = item.trigger === 'keydown' ? 'key' : item.trigger === 'pointerover' ? 'hover' : item.trigger as 'click' | 'change';
    const action = kind === 'key' ? `Press ${item.key}` : kind === 'hover' ? 'Hover' : kind === 'change' ? 'Change' : 'Click';
    steps.push({ at: item.at, kind, label: `${action} · ${name(item)}`, observation: item });
  }
  return steps.sort((a, b) => a.at - b.at);
}

export function adjacentStep(steps: ReplayStep[], at: number, direction: -1 | 1): ReplayStep | undefined {
  if (direction === 1) return steps.find(step => step.at > at + 1);
  for (let index = steps.length - 1; index >= 0; index--) if (steps[index]!.at < at - 1) return steps[index];
}

export function observationReplayTime(recording: Recording, observation: Observation): number {
  const expected = observation.element.attributes;
  if (!expected) return observation.at;
  const stateAttributes = new Set(['aria-expanded', 'aria-hidden', 'hidden', 'open', 'data-state']);
  const epoch = recording.events[0]!.timestamp;
  // Synchronous focus/key evidence can precede rrweb's mutation microtask. Keep the sample time intact.
  for (const event of recording.events) {
    const at = event.timestamp - epoch;
    if (at < observation.at) continue;
    if (at > observation.at + 50) break;
    if (event.type !== 3 || event.data.source !== 0 || !Array.isArray(event.data.attributes)) continue;
    const changed = event.data.attributes.find(item => item?.id === observation.element.nodeId);
    if (!changed?.attributes || typeof changed.attributes !== 'object' || Array.isArray(changed.attributes)) continue;
    const states = Object.entries(changed.attributes).filter(([key]) => stateAttributes.has(key));
    if (states.length && states.every(([key, value]) => value === (expected[key] ?? null))) return at;
  }
  return observation.at;
}
