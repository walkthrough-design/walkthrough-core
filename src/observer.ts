import { captureElement, capturePanel, captureStructure, findControlledPanel, getControlKey, type Observation } from './index';

const privateSelector = '[data-private],[data-walkthrough-block],[data-recorder-controls],.rr-block,.rr-mask';
const controlSelector = 'button,[role="button"],[aria-expanded],[aria-controls],[aria-owns]';

export function startInteractionObserver(getNodeId: (element: Element) => number, emit: (observation: Observation) => void, now: () => number): () => void {
  const controls = new Set<Element>();
  const structures = new WeakMap<Element, string>();
  const pending = new Map<Element, boolean>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listeners: [string, EventListener][] = [];
  let frame = 0;
  let stopped = false;
  let lastHover = -Infinity;

  function panelFor(control: Element) {
    return findControlledPanel(control)?.panel ?? null;
  }

  function track(control: Element) {
    if (!control.hasAttribute('aria-expanded') && !control.hasAttribute('aria-controls') && !control.hasAttribute('aria-owns')) return;
    controls.delete(control);
    // shortcut: observe 12 recently used controls, widen after profiling larger flows.
    if (controls.size >= 12) controls.delete(controls.values().next().value!);
    controls.add(control);
  }

  function observe(trigger: string, element: Element, key?: Observation['key'], dirty = false, eventAt?: number) {
    if (stopped || element.closest(privateSelector)) return;
    const nodeId = getNodeId(element);
    if (nodeId < 0) return;
    try {
      const at = now();
      const observation: Observation = { at, trigger, element: captureElement(element, nodeId), ...(key ? { key } : {}), ...(eventAt !== undefined ? { eventAt } : {}) };
      const panel = capturePanel(element, getNodeId, false);
      if (panel) {
        const root = element.ownerDocument.getElementById(panel.targetId);
        const signature = `${panel.element.nodeId}:${element.getAttribute('aria-expanded')}:${panel.element.styles.display}:${panel.element.styles.visibility}`;
        if (root && (dirty || structures.get(root) !== signature)) {
          panel.structure = captureStructure(root, getNodeId);
          structures.set(root, signature);
        }
        observation.panel = panel;
      }
      emit(observation);
    } catch { /* Detached nodes do not have usable evidence. */ }
  }

  function flush() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const entries = [...pending];
    pending.clear();
    for (const [control, dirty] of entries) observe('state-change', control, undefined, dirty);
  }

  function schedule(control: Element, dirty: boolean) {
    pending.set(control, dirty || pending.get(control) === true);
    frame ||= requestAnimationFrame(flush);
  }

  function targetEvent(type: string, target: Element, key: Observation['key'] | undefined, eventAt: number) {
    const control = target.closest(controlSelector);
    if (control) track(control);
    observe(type, target, key, false, eventAt);
    if (control && control !== target) observe(type, control, key, false, eventAt);
  }

  const mutations = new MutationObserver(records => {
    for (const control of controls) {
      if (!control.isConnected) { controls.delete(control); continue; }
      const panel = panelFor(control);
      let relevant = false;
      let dirty = false;
      for (const mutation of records) {
        if (mutation.target === control) relevant = true;
        if (!panel) continue;
        if (mutation.target === panel || panel.contains(mutation.target)) { relevant = true; dirty = true; break; }
        if (mutation.type === 'childList') for (const node of mutation.addedNodes) {
          if (node === panel || node.contains(panel)) { relevant = true; dirty = true; break; }
        }
        if (dirty) break;
      }
      if (relevant) schedule(control, dirty);
    }
  });
  mutations.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-controls', 'aria-owns', 'aria-hidden', 'hidden', 'open', 'data-state'] });

  for (const type of ['click', 'focusin', 'focusout', 'change', 'animationstart', 'animationend', 'transitionrun', 'transitionend', 'keydown', 'pointerover', 'pointerout']) {
    const listener: EventListener = event => {
      const eventAt = now();
      const target = event.composedPath()[0];
      if (!(target instanceof Element) || target.closest(privateSelector)) return;
      const control = target.closest(controlSelector);
      if (control && !controls.has(control) && (control.hasAttribute('aria-expanded') || control.hasAttribute('aria-controls') || control.hasAttribute('aria-owns'))) {
        track(control);
        observe('initial-state', control);
      }
      const keyboard = event as KeyboardEvent;
      const key = type === 'keydown' && !keyboard.altKey && !keyboard.ctrlKey && !keyboard.metaKey && !keyboard.shiftKey ? getControlKey(keyboard.key) : undefined;
      if (type === 'keydown' && !key) return;
      if (type === 'pointerover' || type === 'pointerout') {
        if (performance.now() - lastHover < 180) return;
        lastHover = performance.now();
      }
      // A control key may remove its target before a deferred observation can read it.
      if (type === 'keydown' || type === 'focusout') { targetEvent(type, target, key, eventAt); return; }
      const timer = setTimeout(() => { timers.delete(timer); if (!stopped) targetEvent(type, target, key, eventAt); }, 0);
      timers.add(timer);
    };
    listeners.push([type, listener]);
    document.addEventListener(type, listener, true);
  }

  let checked = 0;
  for (const control of document.querySelectorAll('[aria-expanded]')) {
    if (++checked > 64 || controls.size >= 8) break;
    if (control.closest(privateSelector) || !control.getClientRects().length) continue;
    track(control);
    observe('initial-state', control);
  }

  return () => {
    mutations.disconnect();
    for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
    for (const timer of timers) clearTimeout(timer);
    flush();
    stopped = true;
    controls.clear();
  };
}
