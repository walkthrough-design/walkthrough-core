import { CONTROL_KEYS, MAX_STRUCTURE_NODES, SEMANTIC_ATTRIBUTES, STYLE_PROPERTIES, type CaptureBatch, type CapturedStructure, type Recording, type ElementEvidence, type Observation, type Remix, type eventWithTime } from './index';
import { validTextEdits, validTextParts } from './text';
import { MOTION_TAG, isMotionSample, type MotionSample } from './motion';

export const MAX_RECORDING_BYTES = 128 * 1024 * 1024;
export const MAX_EVENTS = 250_000;
export const MAX_OBSERVATIONS = 50_000;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Invalid recording: ${message}`); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function attributes(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([key, item]) => (SEMANTIC_ATTRIBUTES as readonly string[]).includes(key) && typeof item === 'string' && item.length <= 256);
}
function structure(value: unknown): value is CapturedStructure {
  if (!object(value) || typeof value.truncated !== 'boolean' || !Array.isArray(value.nodes) || value.nodes.length > MAX_STRUCTURE_NODES) return false;
  const ids = new Set<number>();
  for (const [index, node] of value.nodes.entries()) {
    if (!object(node) || !finite(node.nodeId) || !Number.isInteger(node.nodeId) || node.nodeId < 0 || ids.has(node.nodeId) || typeof node.tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(node.tag) || ['script', 'style', 'iframe', 'object', 'embed', 'base', 'meta', 'link'].includes(node.tag) || typeof node.text !== 'string' || node.text.length > 160 || !attributes(node.attributes) || !object(node.styles) || Object.keys(node.styles).length > 64 || !Object.values(node.styles).every(item => typeof item === 'string' && item.length <= 2048)) return false;
    if (index === 0 ? node.parentId !== null : !finite(node.parentId) || !ids.has(node.parentId)) return false;
    ids.add(node.nodeId);
  }
  const nodes = new Map(value.nodes.map(node => [node.nodeId, node]));
  const childCounts = new Map<number, number>();
  for (const node of value.nodes) if (node.parentId !== null) childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
  let totalText = 0;
  for (const node of value.nodes) {
    if (node.content === undefined) { totalText += node.text.length; continue; }
    if (!Array.isArray(node.content) || node.content.length > 256) return false;
    const refs = new Set<number>();
    let text = '';
    for (const part of node.content) {
      if (!object(part) || Object.keys(part).length !== 1) return false;
      if (typeof part.text === 'string') text += part.text;
      else if (finite(part.nodeId) && nodes.get(part.nodeId)?.parentId === node.nodeId && !refs.has(part.nodeId)) refs.add(part.nodeId);
      else return false;
    }
    if (text.length > 160 || text.trim().replace(/\s+/g, ' ') !== node.text || refs.size !== (childCounts.get(node.nodeId) ?? 0)) return false;
    totalText += text.length;
  }
  if (totalText > 8000) return false;
  return true;
}

function element(value: unknown): value is ElementEvidence {
  if (!object(value) || !finite(value.nodeId) || typeof value.tag !== 'string' || typeof value.selector !== 'string' || typeof value.label !== 'string' || !object(value.styles) || !strings(value.states) || !object(value.rect) || !Array.isArray(value.animations)) return false;
  if (!Object.values(value.styles).every(item => typeof item === 'string') || !['x', 'y', 'width', 'height'].every(key => finite((value.rect as Record<string, unknown>)[key]))) return false;
  if (value.attributes !== undefined && !attributes(value.attributes)) return false;
  return value.animations.every(item => object(item) && typeof item.name === 'string' && finite(item.duration) && finite(item.delay) && finite(item.iterations) && (item.infinite === undefined || typeof item.infinite === 'boolean') && typeof item.easing === 'string' && Array.isArray(item.keyframes) && item.keyframes.every(frame => object(frame) && Object.values(frame).every(v => v === null || typeof v === 'string' || finite(v))));
}

export function readReplayEvent(event: unknown): eventWithTime {
  assert(object(event) && finite(event.timestamp) && Number.isInteger(event.type) && Number(event.type) >= 0 && Number(event.type) <= 6 && object(event.data), 'malformed replay event.');
  if (event.type === 2) assert(object(event.data.node) && finite(event.data.node.id), 'full snapshot is missing its document.');
  if (event.type === 5 && event.data.tag === MOTION_TAG) assert(isMotionSample(event.data.payload), 'malformed motion evidence.');
  return event as unknown as eventWithTime;
}

export function readObservation(observation: unknown, duration: number): Observation {
  assert(object(observation) && finite(observation.at) && observation.at >= 0 && observation.at <= duration + 1000 && typeof observation.trigger === 'string' && element(observation.element), 'malformed element evidence.');
  if (observation.eventAt !== undefined) assert(finite(observation.eventAt) && observation.eventAt >= 0 && observation.eventAt <= observation.at, 'invalid input event time.');
  if (observation.key !== undefined) assert(observation.trigger === 'keydown' && (CONTROL_KEYS as readonly unknown[]).includes(observation.key), 'unsupported control key.');
  if (observation.panel !== undefined) {
    const panel = observation.panel;
    assert(object(panel) && ['aria-controls', 'aria-owns'].includes(String(panel.relation)) && typeof panel.targetId === 'string' && panel.targetId.length > 0 && panel.targetId.length <= 256 && element(panel.element), 'malformed panel evidence.');
    if (panel.structure !== undefined) assert(structure(panel.structure) && (!panel.structure.nodes.length || panel.structure.nodes[0].nodeId === panel.element.nodeId), 'malformed panel structure.');
  }
  return observation as unknown as Observation;
}

export function readRecording(value: unknown): Recording {
  assert(object(value) && value.format === 'walkthrough' && value.version === 1, 'unsupported format or version.');
  assert(typeof value.id === 'string' && value.id.length > 0 && typeof value.name === 'string' && typeof value.createdAt === 'string', 'missing recording identity.');
  assert(object(value.source) && typeof value.source.url === 'string' && typeof value.source.title === 'string' && object(value.source.viewport), 'missing source.');
  const viewport = value.source.viewport;
  assert(finite(viewport.width) && viewport.width > 0 && viewport.width <= 16_384 && finite(viewport.height) && viewport.height > 0 && viewport.height <= 16_384, 'unsupported viewport.');
  assert(finite(value.duration) && value.duration >= 0 && value.duration <= 3_600_000, 'duration must be under one hour.');
  assert(typeof value.complete === 'boolean' && strings(value.gaps), 'missing completeness flags.');
  assert(Array.isArray(value.events) && value.events.length >= 2 && value.events.length <= MAX_EVENTS, `expected 2–${MAX_EVENTS.toLocaleString('en-US')} replay events.`);
  let last = -Infinity;
  let fullSnapshots = 0;
  const motionTracks = new Set<number>();
  let motionSamples = 0;
  let motionAt = -1;
  for (const raw of value.events) {
    const event = readReplayEvent(raw);
    assert(event.timestamp >= last, 'events must be in time order.');
    if (event.type === 2) fullSnapshots++;
    if (event.type === 5 && event.data.tag === MOTION_TAG) {
      const sample = event.data.payload;
      assert(isMotionSample(sample) && sample.at >= motionAt && sample.at <= value.duration + 1000 && ++motionSamples <= 12_000, 'malformed or oversized motion evidence.');
      if (sample.definition) { assert(!motionTracks.has(sample.id), 'duplicate motion definition.'); motionTracks.add(sample.id); }
      assert(motionTracks.has(sample.id), 'motion state has no definition.');
      motionAt = sample.at;
    }
    last = event.timestamp;
  }
  assert(fullSnapshots > 0, 'a full DOM snapshot is required.');
  assert(Array.isArray(value.observations) && value.observations.length <= MAX_OBSERVATIONS, 'unsupported inspection observations.');
  for (const observation of value.observations) readObservation(observation, value.duration);
  return value as unknown as Recording;
}

export function parseRecording(text: string): Recording {
  if (new TextEncoder().encode(text).byteLength > MAX_RECORDING_BYTES) throw new Error(`Recording exceeds the ${MAX_RECORDING_BYTES / 1024 / 1024} MB file limit.`);
  try { return readRecording(JSON.parse(text)); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('This file is not valid JSON.'); throw error; }
}

export function readRemix(value: unknown): Remix {
  const fail = () => { throw new Error('Invalid remix: unsupported identity, selection, edits or source reference.'); };
  if (!object(value) || value.format !== 'walkthrough-remix' || value.version !== 1 || typeof value.id !== 'string' || !/^[\w-]{1,128}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.recordingId !== 'string' || !value.recordingId || typeof value.recordingHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.recordingHash)) return fail();
  const selection = value.selection;
  const provenance = (part: Record<string, unknown>) => part.provenance === 'captured' || part.provenance === 'recomputed';
  const part = (item: unknown) => object(item) && finite(item.at) && item.at >= 0 && item.at <= 3_601_000 && element(item.element) && Number.isInteger(item.element.nodeId) && item.element.nodeId >= 0 && provenance(item);
  if (!object(selection) || !part(selection) || selection.capturedAt !== undefined && (!finite(selection.capturedAt) || selection.capturedAt < 0 || selection.capturedAt > 3_601_000) || !object(selection.overrides) || Object.keys(selection.overrides).length > STYLE_PROPERTIES.length) return fail();
  for (const [key, item] of Object.entries(selection.overrides)) if (!(STYLE_PROPERTIES as readonly string[]).includes(key) || typeof item !== 'string' || item.length > 2048 || /url\s*\(|[;{}<>]/i.test(item)) return fail();
  if (selection.text !== undefined && !validTextParts(selection.text) || selection.textOverrides !== undefined && !validTextEdits(selection.textOverrides)) return fail();
  if (selection.nodeOverrides !== undefined) {
    if (!object(selection.nodeOverrides) || Object.keys(selection.nodeOverrides).length > 1000) return fail();
    for (const [id, edits] of Object.entries(selection.nodeOverrides)) {
      if (!/^\d+$/.test(id) || !object(edits) || Object.keys(edits).length > STYLE_PROPERTIES.length) return fail();
      for (const [key, item] of Object.entries(edits)) if (!(STYLE_PROPERTIES as readonly string[]).includes(key) || typeof item !== 'string' || item.length > 2048 || /url\s*\(|[;{}<>]/i.test(item)) return fail();
    }
  }
  if (selection.linkedPanel !== undefined && (!object(selection.linkedPanel) || !part(selection.linkedPanel) || !structure(selection.linkedPanel.structure) || selection.linkedPanel.structure.nodes[0]?.nodeId !== (selection.linkedPanel.element as ElementEvidence).nodeId)) return fail();
  if (selection.structure !== undefined && (!structure(selection.structure) || selection.structure.nodes[0]?.nodeId !== (selection.element as ElementEvidence).nodeId)) return fail();
  if (selection.linkedTrigger !== undefined && !part(selection.linkedTrigger)) return fail();
  if (!object(value.options) || !['structure', 'styles', 'animations', 'states', 'interactions'].every(key => typeof (value.options as Record<string, unknown>)[key] === 'boolean') || typeof value.task !== 'string' || value.task.length > 2000 || typeof value.target !== 'string' || value.target.length > 300) return fail();
  return value as unknown as Remix;
}

export async function recordingHash(recording: Recording): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(recording)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Each document starts rrweb's IDs again. Remap every reference before joining its evidence.
export function joinCaptureDocuments(startEpoch: number, duration: number, chunks: CaptureBatch[]): Pick<Recording, 'events' | 'observations' | 'duration'> {
  const nodes = new Map<string, number>();
  const styles = new Map<string, number>();
  const tracks = new Map<string, number>();
  const referenceKeys = new Set(['id', 'nodeId', 'rootId', 'parentId', 'nextId', 'previousId']);
  const id = (map: Map<string, number>, document: string, value: number) => {
    if (value < 0) return value;
    const key = `${document}:${value}`;
    if (!map.has(key)) map.set(key, map.size + 1);
    return map.get(key)!;
  };
  function remap(value: unknown, document: string, key = ''): unknown {
    if (typeof value === 'number' && referenceKeys.has(key)) return id(nodes, document, value);
    if (typeof value === 'number' && (key === 'styleId' || key === 'styleIds')) return id(styles, document, value);
    // The caller owns these decoded batches; remap in place to avoid duplicating the recording in memory.
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = remap(value[i], document, key); }
    else if (value && typeof value === 'object') { const object = value as Record<string, unknown>; for (const name of Object.keys(object)) object[name] = remap(object[name], document, name); }
    return value;
  }
  let firstTimestamp = Infinity;
  for (const chunk of chunks) if (chunk.events.length) firstTimestamp = Math.min(firstTimestamp, chunk.events[0]!.timestamp);
  if (!Number.isFinite(firstTimestamp)) throw new Error('No recording events were saved.');
  const offset = firstTimestamp - startEpoch;
  const events: Recording['events'] = [];
  const observations: Recording['observations'] = [];
  let motionSamples = 0;
  for (const chunk of chunks) {
    const document = chunk.documentId!;
    for (const event of chunk.events) {
      if (event.type === 5 && event.data.tag === MOTION_TAG) {
        const sample = event.data.payload as MotionSample;
        const key = `${document}:${sample.id}`;
        if (sample.definition && !tracks.has(key) && tracks.size < 256) tracks.set(key, tracks.size);
        if (!tracks.has(key) || motionSamples++ >= 12_000) continue;
        events.push({ ...event, data: { ...event.data, payload: {
          ...sample, id: tracks.get(key)!, at: Math.max(0, sample.at - offset),
          ...(sample.clockAt === undefined ? {} : { clockAt: sample.clockAt - offset }),
          ...(sample.definition ? { definition: { ...sample.definition, nodeId: id(nodes, document, sample.definition.nodeId) } } : {}),
        } } });
      } else {
        const mapped = remap(event, document) as Recording['events'][number];
        if (mapped.type === 3 && mapped.data.source === 14) for (const range of mapped.data.ranges) {
          range.start = id(nodes, document, range.start); range.end = id(nodes, document, range.end);
        }
        events.push(mapped);
      }
    }
    for (const observation of chunk.observations) observations.push({
      ...remap(observation, document) as Recording['observations'][number], at: Math.max(0, observation.at - offset),
      ...(observation.eventAt === undefined ? {} : { eventAt: Math.max(0, observation.eventAt - offset) }),
    });
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  observations.sort((a, b) => a.at - b.at);
  return { events, observations, duration: Math.max(0, duration - offset) };
}

