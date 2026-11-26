import { CONTROL_KEYS, MAX_STRUCTURE_NODES, SEMANTIC_ATTRIBUTES, STYLE_PROPERTIES, type CapturedStructure, type ControlKey, type ElementEvidence, type PanelEvidence } from './index';

const PRIVATE = '.rr-mask,.rr-block,[data-private],[data-walkthrough-block]';
const FIELDS = 'input,textarea,select,[contenteditable]';

function attributes(element: Element): Record<string, string> {
  if (element.closest(`${FIELDS},${PRIVATE}`)) return {};
  return Object.fromEntries(SEMANTIC_ATTRIBUTES.filter(name => element.hasAttribute(name)).map(name => [name, element.getAttribute(name)!.slice(0, 256)]));
}

const UNREAD = `${FIELDS},${PRIVATE},script,style,noscript`;

function readText(root: Element, skip = UNREAD): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  let visited = 0;
  while (text.length < 100 && visited++ < 500) {
    const node = walker.nextNode();
    if (!node) break;
    if (!node.parentElement?.closest(skip)) text += ` ${node.textContent ?? ''}`;
  }
  return text;
}

function rendered(element: Element): boolean {
  const win = element.ownerDocument.defaultView!;
  if (element.closest('[hidden]') || ['hidden', 'collapse'].includes(win.getComputedStyle(element).visibility)) return false;
  for (let node: Element | null = element; node; node = node.parentElement) if (win.getComputedStyle(node).display === 'none') return false;
  return true;
}

/** Visible text referenced by aria-labelledby. A missing, hidden or private reference drops the whole name. */
function referencedLabel(element: Element): string {
  const ids = element.getAttribute('aria-labelledby')?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (ids.length > 8) return '';
  const parts: string[] = [];
  for (const id of ids) {
    const target = id.length <= 256 ? element.ownerDocument.getElementById(id) : null;
    if (!target || target.closest(`${FIELDS},${PRIVATE}`) || target.querySelector(`${FIELDS},${PRIVATE}`) || !rendered(target)) return '';
    parts.push(readText(target, `${UNREAD},[hidden]`));
  }
  return parts.join(' ').trim();
}

export function getControlKey(value: string): ControlKey | undefined {
  const key = value === ' ' ? 'Space' : value;
  return (CONTROL_KEYS as readonly string[]).includes(key) ? key as ControlKey : undefined;
}

export function cleanUrl(value: string): string {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return 'unknown'; }
}

export function captureElement(element: Element, nodeId: number): ElementEvidence {
  const win = element.ownerDocument.defaultView;
  if (!win) throw new Error('The selected document is no longer available.');
  const computed = win.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const styles = Object.fromEntries(STYLE_PROPERTIES.map(property => [property, computed.getPropertyValue(property)]));
  const states = [':hover', ':focus', ':focus-visible', ':active', ':disabled', ':checked', '[open]', '[aria-expanded="true"]'].filter(state => element.matches(state));
  const animations = element.getAnimations().slice(0, 12).map(animation => {
    const effect = animation.effect as KeyframeEffect | null;
    const timing = effect?.getTiming();
    return {
      name: ('animationName' in animation ? String(animation.animationName) : 'transitionProperty' in animation ? String(animation.transitionProperty) : animation.id) || 'Observed animation',
      keyframes: (effect?.getKeyframes() ?? []).map(frame => Object.fromEntries(Object.entries(frame).filter(([key, value]) => key !== 'composite' && key !== 'computedOffset' && (typeof value === 'string' || typeof value === 'number' || value === null)))) as Record<string, string | number | null>[],
      duration: typeof timing?.duration === 'number' ? timing.duration : 0,
      delay: timing?.delay ?? 0,
      easing: timing?.easing ?? 'linear',
      iterations: typeof timing?.iterations === 'number' && Number.isFinite(timing.iterations) ? timing.iterations : 1,
      ...(timing?.iterations === Infinity ? { infinite: true } : {}),
    };
  });
  const tag = element.tagName.toLowerCase();
  // Never copy field values or private/block-marked text into inspection evidence.
  const privateText = element.closest(`${FIELDS},${PRIVATE}`);
  // aria-labelledby names icon-only controls with visible page text; it takes precedence, as in the accessible name.
  const label = privateText ? `${tag} (masked)` : (referencedLabel(element) || element.getAttribute('aria-label') || readText(element) || tag).trim().replace(/\s+/g, ' ').slice(0, 100);
  const id = element.id ? `#${CSS.escape(element.id)}` : '';
  const classes = [...element.classList].filter(name => !name.startsWith('rr-')).slice(0, 2).map(name => `.${CSS.escape(name)}`).join('');
  return { nodeId, tag, selector: `${tag}${id || classes}`, label, styles, states, animations, attributes: attributes(element), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}

export function captureStructure(root: Element, getNodeId: (element: Element) => number): CapturedStructure {
  const result: CapturedStructure = { nodes: [], truncated: false };
  const win = root.ownerDocument.defaultView;
  if (!win || root.closest(PRIVATE)) return result;
  let visited = 0;
  let textBudget = 8000;
  const layout = STYLE_PROPERTIES.filter(property => !/^(animation|transition)-/.test(property) && property !== 'opacity' && property !== 'transform');
  function walk(element: Element, parentId: number | null, depth: number) {
    if (result.nodes.length >= MAX_STRUCTURE_NODES || depth > 12 || ++visited > 1000) { result.truncated = true; return; }
    if (element.matches('script,style,noscript,iframe,object,embed,base,meta,link') || element.closest(PRIVATE)) return;
    const nodeId = getNodeId(element);
    if (nodeId < 0) { result.truncated = true; return; }
    const computed = win!.getComputedStyle(element);
    const node = { nodeId, parentId, tag: element.tagName.toLowerCase(), text: '', content: [] as NonNullable<CapturedStructure['nodes'][number]['content']>, attributes: attributes(element), styles: Object.fromEntries(layout.map(property => [property, computed.getPropertyValue(property)])) };
    result.nodes.push(node);
    let textLength = 0;
    function appendText(value: string) {
      const available = Math.min(160 - textLength, textBudget);
      if (value.length > available) result.truncated = true;
      const text = value.slice(0, available);
      textLength += text.length;
      textBudget -= text.length;
      if (text) { node.content.push({ text }); node.text += text; }
    }
    if (element.closest(FIELDS)) appendText('(masked)');
    else if (!element.matches('svg,canvas')) {
      let read = 0;
      for (const child of element.childNodes) {
        if (++read > 256) { result.truncated = true; break; }
        if (child.nodeType === 3) appendText(child.textContent ?? '');
        else if (child.nodeType === 1) {
          const childId = walk(child as Element, nodeId, depth + 1);
          if (childId !== undefined) node.content.push({ nodeId: childId });
        }
      }
    }
    node.text = node.text.trim().replace(/\s+/g, ' ');
    return nodeId;
  }
  walk(root, null, 0);
  if (textBudget <= 0) result.truncated = true;
  return result;
}

export function findControlledPanel(control: Element): { relation: 'aria-controls' | 'aria-owns'; targetId: string; panel: Element } | undefined {
  if (control.closest(`${PRIVATE},${FIELDS}`)) return;
  for (const relation of ['aria-controls', 'aria-owns'] as const) {
    const targets = control.getAttribute(relation)?.trim().split(/\s+/) ?? [];
    for (const targetId of targets) {
      const panel = control.ownerDocument.getElementById(targetId);
      if (targetId.length > 256 || !panel || panel === control || panel.contains(control) || panel.closest(PRIVATE) || panel.matches('iframe,script,style,object,embed')) continue;
      return { relation, targetId, panel };
    }
  }
}

export function capturePanel(control: Element, getNodeId: (element: Element) => number, includeStructure = true): PanelEvidence | undefined {
  const resolved = findControlledPanel(control);
  if (!resolved) return;
  const { relation, targetId, panel } = resolved;
  const nodeId = getNodeId(panel);
  if (nodeId < 0) return;
  return { relation, targetId, element: captureElement(panel, nodeId), ...(includeStructure ? { structure: captureStructure(panel, getNodeId) } : {}) };
}
