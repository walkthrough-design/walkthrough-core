import type { eventWithTime } from './index';

export const MOTION_TAG = 'walkthrough:motion';
const MAX_TRACKS = 256;
const MAX_SAMPLES = 12_000;
const properties = new Set('opacity transform translate rotate scale filter clipPath color backgroundColor borderColor borderRadius borderWidth boxShadow width height minWidth maxWidth minHeight maxHeight left right top bottom inset margin padding gap fontSize fontWeight lineHeight letterSpacing outlineColor outlineWidth offsetDistance'.split(' '));
type Frame = Record<string, string | number | null>;
type Timing = Omit<EffectTiming, 'duration' | 'iterations'> & { duration: number; iterations: number | 'infinite' };
export interface MotionSample {
  id: number; at: number; currentTime: number | null; playbackRate: number; playState: AnimationPlayState;
  clockAt?: number; pending?: boolean;
  definition?: { nodeId: number; initial: boolean; keyframes: Frame[]; timing: Timing; composite?: CompositeOperation; native?: { kind: 'animation' | 'transition'; name: string } };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown, limit = 1e12): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 2048 && !/url\s*\(|[\\<>{};]/i.test(value);

export function isMotionSample(value: unknown): value is MotionSample {
  if (!object(value) || !Number.isInteger(value.id) || Number(value.id) < 0 || Number(value.id) >= MAX_TRACKS || !number(value.at, 3_601_000) || value.at < 0 || value.currentTime !== null && !number(value.currentTime) || !number(value.playbackRate, 1000) || !['idle', 'running', 'paused', 'finished'].includes(String(value.playState))) return false;
  if (value.clockAt !== undefined && (!number(value.clockAt) || value.clockAt > value.at || value.clockAt < value.at - 60_000) || value.pending !== undefined && typeof value.pending !== 'boolean') return false;
  if (value.definition === undefined) return true;
  const d = value.definition;
  if (!object(d) || !Number.isInteger(d.nodeId) || Number(d.nodeId) < 0 || typeof d.initial !== 'boolean' || !Array.isArray(d.keyframes) || !d.keyframes.length || d.keyframes.length > 100 || !object(d.timing)) return false;
  if (d.composite !== undefined && !['replace', 'add', 'accumulate'].includes(String(d.composite))) return false;
  if (d.native !== undefined && (!object(d.native) || !['animation', 'transition'].includes(String(d.native.kind)) || !text(d.native.name))) return false;
  const t = d.timing;
  if (!number(t.duration) || t.duration < 0 || t.iterations !== 'infinite' && (!number(t.iterations) || t.iterations < 0) || !number(t.delay) || !number(t.endDelay) || !number(t.iterationStart) || t.iterationStart < 0 || !text(t.easing) || !['normal', 'reverse', 'alternate', 'alternate-reverse'].includes(String(t.direction)) || !['none', 'auto', 'backwards', 'forwards', 'both'].includes(String(t.fill))) return false;
  return d.keyframes.every(frame => object(frame) && Object.keys(frame).length <= 48 && Object.entries(frame).every(([key, item]) => key === 'offset' ? item === null || number(item, 1) && item >= 0 : key === 'easing' ? text(item) : key === 'composite' ? ['auto', 'replace', 'add', 'accumulate'].includes(String(item)) : properties.has(key) && (text(item) || number(item))));
}

export function motionTime(sample: MotionSample, at: number): number | null {
  return sample.currentTime === null ? null : sample.currentTime + (sample.playState === 'running' && !sample.pending ? (at - (sample.clockAt ?? sample.at)) * sample.playbackRate : 0);
}

/** Observe WAAPI effects without patching page functions or reading application state. */
export function startMotionObserver(getNodeId: (element: Element) => number, emit: (sample: MotionSample) => void, elapsed: () => number): () => void {
  const tracked = new Map<Animation, MotionSample>();
  const unsupported = new WeakSet<Animation>();
  const cleanups: (() => void)[] = [];
  let nextId = 0;
  let samples = 0;
  let frame = 0;
  let stopped = false;
  function sample(animation: Animation, initial = false) {
    if (stopped || samples >= MAX_SAMPLES || unsupported.has(animation)) return;
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!target || effect?.pseudoElement || target.closest('input,textarea,select,[contenteditable],.rr-mask,.rr-block,[data-private],[data-walkthrough-block]')) return;
    const prior = tracked.get(animation);
    const nodeId = getNodeId(target);
    if (nodeId < 0 || !prior && nextId >= MAX_TRACKS) return;
    const value: MotionSample = { id: prior?.id ?? nextId, at: elapsed(), currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null, playbackRate: animation.playbackRate, playState: animation.replaceState === 'removed' ? 'idle' : animation.playState };
    value.pending = animation.pending;
    // Animation currentTime is sampled on the document frame clock, not on callback receipt.
    if (typeof document.timeline.currentTime === 'number') value.clockAt = value.at - Math.max(0, performance.now() - document.timeline.currentTime);
    // Scroll timelines report CSSNumericValue; a time-based replay cannot reconstruct them.
    if (animation.currentTime !== null && typeof animation.currentTime !== 'number') { unsupported.add(animation); return; }
    if (!prior) {
      const timing = effect.getTiming();
      if (typeof timing.duration !== 'number') { unsupported.add(animation); return; }
      const keyframes = effect.getKeyframes().map(({ computedOffset, ...rest }) => ({ ...rest, offset: computedOffset }));
      value.definition = { nodeId, initial, composite: effect.composite, keyframes: keyframes as Frame[], timing: { ...timing, duration: timing.duration, iterations: timing.iterations === Infinity ? 'infinite' : timing.iterations ?? 1 } };
      if ('animationName' in animation) value.definition.native = { kind: 'animation', name: String(animation.animationName) };
      else if ('transitionProperty' in animation) value.definition.native = { kind: 'transition', name: String(animation.transitionProperty) };
    }
    if (!isMotionSample(value)) { unsupported.add(animation); return; }
    const predicted = prior && motionTime(prior, value.clockAt ?? value.at);
    if (prior && prior.playState === value.playState && prior.pending === value.pending && prior.playbackRate === value.playbackRate && (predicted === value.currentTime || predicted !== null && value.currentTime !== null && Math.abs(predicted! - value.currentTime) < 4)) { if (value.pending) schedule(); return; }
    if (!prior) {
      nextId++;
      const changed = () => sample(animation);
      for (const type of ['finish', 'cancel', 'remove']) animation.addEventListener(type, changed);
      cleanups.push(() => { for (const type of ['finish', 'cancel', 'remove']) animation.removeEventListener(type, changed); });
    }
    tracked.set(animation, value);
    samples++;
    emit(value);
    if (value.pending) schedule();
  }
  function scan(initial = false) {
    if (stopped) return;
    const animations = document.getAnimations();
    // Prefer JS effects when the track bound is reached; their progress is absent from DOM mutations.
    for (const animation of animations) if (!('animationName' in animation) && !('transitionProperty' in animation)) sample(animation, initial);
    for (const animation of animations) if ('animationName' in animation || 'transitionProperty' in animation) sample(animation, initial);
    for (const animation of tracked.keys()) if (animation.playState === 'idle' || animation.replaceState === 'removed') sample(animation);
  }
  const schedule = () => { if (!frame && !stopped) frame = requestAnimationFrame(() => { frame = 0; scan(); }); };
  const events = ['click', 'pointerover', 'focusin', 'keydown', 'animationstart', 'transitionrun'];
  for (const type of events) document.addEventListener(type, schedule, true);
  scan(true);
  // shortcut: poll for autonomous starts; animations shorter than 250 ms can be missed.
  const timer = setInterval(scan, 250);
  return () => {
    stopped = true; clearInterval(timer); cancelAnimationFrame(frame);
    for (const type of events) document.removeEventListener(type, schedule, true);
    cleanups.forEach(cleanup => cleanup()); tracked.clear();
  };
}

export function createMotionReplay(events: eventWithTime[], getNode: (id: number) => Node | null, onError: () => void) {
  const tracks = new Map<number, { definition: NonNullable<MotionSample['definition']>; samples: MotionSample[] }>();
  for (const event of events) if (event.type === 5 && event.data.tag === MOTION_TAG && isMotionSample(event.data.payload)) {
    const sample = event.data.payload;
    if (sample.definition) tracks.set(sample.id, { definition: sample.definition, samples: [] });
    tracks.get(sample.id)?.samples.push(sample);
  }
  const live = new Map<number, { node: Element; animation: Animation }>();
  const failed = new Set<number>();
  return {
    size: tracks.size,
    sync(at: number) {
      for (const [id, track] of tracks) {
        let sample: MotionSample | undefined;
        for (const item of track.samples) { if (item.at > at) break; sample = item; }
        sample ??= track.definition.initial ? track.samples[0] : undefined;
        const node = getNode(track.definition.nodeId);
        let current = live.get(id);
        if (!sample || sample.playState === 'idle' || sample.currentTime === null || !node?.isConnected || node.nodeType !== 1 || current && node !== current.node) {
          current?.animation.cancel(); live.delete(id); current = undefined;
        }
        if (!sample || sample.playState === 'idle' || sample.currentTime === null || !node?.isConnected || node.nodeType !== 1 || failed.has(id)) continue;
        try {
          if (!current) {
            // Native CSS effects otherwise restart at zero on seek; only replace captured effects.
            const native = track.definition.native;
            if (native) for (const animation of (node as Element).getAnimations()) {
              if (native.kind === 'animation' ? 'animationName' in animation && animation.animationName === native.name : 'transitionProperty' in animation && animation.transitionProperty === native.name) animation.cancel();
            }
            const { iterations, ...timing } = track.definition.timing;
            const animation = (node as Element).animate(track.definition.keyframes as Keyframe[], { ...timing, composite: track.definition.composite, iterations: iterations === 'infinite' ? Infinity : iterations });
            animation.pause(); current = { node: node as Element, animation }; live.set(id, current);
          }
          current.animation.currentTime = motionTime(sample, at);
        } catch { current?.animation.cancel(); live.delete(id); failed.add(id); onError(); }
      }
    },
    destroy() { for (const { animation } of live.values()) animation.cancel(); live.clear(); },
  };
}
