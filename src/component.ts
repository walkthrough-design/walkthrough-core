import { validTextParts } from './text';

export const MAX_COMPONENT_BYTES = 4 * 1024 * 1024;
const MAX_NODES = 512;
const htmlTags = new Set('a abbr article aside b bdi bdo blockquote br button caption code col colgroup dd del details div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i img input kbd label legend li main mark nav ol optgroup option output p picture pre progress s section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul'.split(' '));
const svgTags = new Set('svg g defs path rect circle ellipse line polyline polygon text tspan clipPath mask linearGradient radialGradient stop use symbol title desc'.split(' '));
const attributes = new Set('id class role title alt type placeholder disabled checked selected open colspan rowspan dir lang width height viewBox preserveAspectRatio d x y x1 y1 x2 y2 cx cy r rx ry points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity transform offset stop-color stop-opacity gradientUnits gradientTransform clip-path clipPathUnits maskUnits maskContentUnits text-anchor dominant-baseline xmlns href'.split(' '));
const blocked = new Set(['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'foreignObject']);
export interface ComponentNode {
  nodeId: number; parentId: number | null; tag: string; svg: boolean;
  attributes: Record<string, string>; styles: Record<string, string>;
  content: ({ text: string } | { nodeId: number })[];
  before?: Record<string, string>; after?: Record<string, string>;
}
export interface SavedComponent {
  format: 'walkthrough-component'; version: 1; id: string; name: string; createdAt: string;
  source: { recordingId: string; recordingName: string; url: string; at: number; nodeId: number; selector: string; provenance: 'recomputed' };
  width: number; height: number; background: string; nodes: ComponentNode[]; truncated: boolean;
  edits?: Record<string, { styles?: Record<string, string>; text?: string[] }>;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function safeCss(value: string): boolean {
  return value.length <= 2048 && !/[\\<>{};\0]/.test(value) && !/url\s*\(/i.test(value.replace(/url\(\s*["']?#[\w-]+["']?\s*\)/g, '')) && !/@import|expression\s*\(/i.test(value);
}
function safeAttribute(name: string, value: string): boolean {
  return value.length <= 8192 && (attributes.has(name) || /^aria-[a-z-]+$/.test(name)) && (name !== 'href' || /^#[\w-]+$/.test(value)) && (!['fill', 'stroke', 'clip-path'].includes(name) || safeCss(value));
}
function styleMap(value: unknown): value is Record<string, string> {
  return object(value) && Object.keys(value).length <= 600 && Object.entries(value).every(([key, item]) => /^-?[a-z][a-z0-9-]*$/.test(key) && typeof item === 'string' && safeCss(item));
}

export function readComponent(value: unknown): SavedComponent {
  const fail = () => { throw new Error('Invalid component: its identity, layers or styles are not supported.'); };
  if (!object(value) || value.format !== 'walkthrough-component' || value.version !== 1 || typeof value.id !== 'string' || !/^[\w-]{1,128}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return fail();
  const source = value.source;
  if (!object(source) || typeof source.recordingId !== 'string' || !source.recordingId || typeof source.recordingName !== 'string' || typeof source.url !== 'string' || typeof source.selector !== 'string' || source.provenance !== 'recomputed' || !Number.isInteger(source.nodeId) || Number(source.nodeId) < 0 || typeof source.at !== 'number' || !Number.isFinite(source.at) || source.at < 0 || source.at > 3_601_000) return fail();
  if (![value.width, value.height].every(size => typeof size === 'number' && Number.isFinite(size) && size > 0 && size <= 16_384) || typeof value.background !== 'string' || !safeCss(value.background) || typeof value.truncated !== 'boolean' || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > MAX_NODES) return fail();
  const nodes = new Map<number, ComponentNode>();
  for (const [index, node] of value.nodes.entries()) {
    if (!object(node) || node.nodeId !== index || typeof node.svg !== 'boolean' || typeof node.tag !== 'string' || !(node.svg ? svgTags : htmlTags).has(node.tag) || (index === 0 ? node.parentId !== null : !nodes.has(Number(node.parentId))) || !object(node.attributes) || !Object.entries(node.attributes).every(([name, item]) => typeof item === 'string' && safeAttribute(name, item)) || !styleMap(node.styles) || node.before !== undefined && !styleMap(node.before) || node.after !== undefined && !styleMap(node.after) || !Array.isArray(node.content) || node.content.length > 2048) return fail();
    nodes.set(index, node as unknown as ComponentNode);
  }
  const referenced = new Set<number>();
  let textSize = 0;
  for (const node of nodes.values()) for (const part of node.content) {
    if (!object(part) || Object.keys(part).length !== 1) return fail();
    if ('text' in part && typeof part.text === 'string') { textSize += part.text.length; if (textSize > 100_000) return fail(); }
    else if ('nodeId' in part && typeof part.nodeId === 'number' && nodes.get(part.nodeId)?.parentId === node.nodeId && !referenced.has(part.nodeId)) referenced.add(part.nodeId);
    else return fail();
  }
  if (value.edits !== undefined) {
    if (!object(value.edits) || Object.keys(value.edits).length > MAX_NODES) return fail();
    for (const [id, edit] of Object.entries(value.edits)) {
      const node = nodes.get(Number(id));
      if (!/^(0|[1-9]\d*)$/.test(id) || !node || !object(edit) || Object.keys(edit).some(key => !['styles', 'text'].includes(key)) || edit.styles !== undefined && !styleMap(edit.styles)) return fail();
      if (edit.text !== undefined) {
        const original = node.content.flatMap(part => 'text' in part ? [part.text] : []);
        if (!validTextParts(edit.text) || !original.length || edit.text.length !== original.length) return fail();
        textSize += edit.text.join('').length - original.join('').length;
      }
    }
  }
  if (textSize > 100_000) return fail();
  const json = JSON.stringify(value);
  // Figma's plugin sandbox may not provide TextEncoder.
  const bytes = typeof TextEncoder === 'undefined' ? encodeURIComponent(json).replace(/%[\da-f]{2}/gi, 'x').length : new TextEncoder().encode(json).byteLength;
  if (referenced.size !== nodes.size - 1 || bytes > MAX_COMPONENT_BYTES) return fail();
  return value as unknown as SavedComponent;
}

/** Freeze a replay subtree's resolved styles so it does not depend on its page's CSS. */
export function captureComponent(root: Element, source: SavedComponent['source']): SavedComponent {
  const win = root.ownerDocument.defaultView;
  const rect = root.getBoundingClientRect();
  if (!win || rect.width <= 0 || rect.height <= 0) throw new Error('Select a visible element to open it as a component.');
  const nodes: ComponentNode[] = [];
  let truncated = false;
  let textSize = 0;
  let bytes = 0;
  const encoder = new TextEncoder();
  const computed = (element: Element, pseudo?: string) => {
    const css = win.getComputedStyle(element, pseudo);
    const values: Record<string, string> = {};
    for (const name of css) { const value = css.getPropertyValue(name); if (!name.startsWith('--') && safeCss(value)) values[name] = value; }
    return values;
  };
  function visit(element: Element, parentId: number | null, depth: number): number | undefined {
    if (blocked.has(element.localName)) { truncated = true; return; }
    if (depth > 30 || nodes.length >= MAX_NODES || bytes > MAX_COMPONENT_BYTES - 80_000) { truncated = true; return; }
    const svg = element.namespaceURI === 'http://www.w3.org/2000/svg';
    if (svg && !svgTags.has(element.localName)) { truncated = true; return; }
    const node: ComponentNode = { nodeId: nodes.length, parentId, svg, tag: svg || htmlTags.has(element.localName) ? element.localName : 'div', attributes: {}, styles: computed(element), content: [] };
    for (const attr of element.attributes) if (safeAttribute(attr.name, attr.value)) node.attributes[attr.name] = attr.value;
    for (const pseudo of ['before', 'after'] as const) {
      const style = win!.getComputedStyle(element, `::${pseudo}`);
      if (!svg && style.content && !['none', 'normal', '""'].includes(style.content)) node[pseudo] = computed(element, `::${pseudo}`);
    }
    nodes.push(node);
    bytes += encoder.encode(JSON.stringify(node)).byteLength;
    const children = element.shadowRoot?.childNodes ?? element.childNodes;
    const privateText = !!element.closest('input,textarea,select,[contenteditable],.rr-mask,[data-private]');
    if (element.matches('[data-walkthrough-block],.rr-block')) { truncated = true; return node.nodeId; }
    for (const child of children) {
      if (child.nodeType === 3) {
        const remaining = Math.max(0, 100_000 - textSize);
        const original = child.textContent ?? '';
        let text = original.slice(0, remaining);
        if (text.length < original.length) truncated = true;
        if (privateText) text = text.replace(/\S/g, '*');
        if (text) { node.content.push({ text }); textSize += text.length; bytes += encoder.encode(text).byteLength; }
      } else if (child.nodeType === 1) {
        const id = visit(child as Element, node.nodeId, depth + 1);
        if (id !== undefined) node.content.push({ nodeId: id });
      }
    }
    return node.nodeId;
  }
  visit(root, null, 0);
  let background = 'rgb(255, 255, 255)';
  for (let parent: Element | null = root; parent; parent = parent.parentElement) {
    const color = win.getComputedStyle(parent).backgroundColor;
    if (color && color !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(color)) { background = color; break; }
  }
  const title = nodes.find(n => /^h[1-6]$/.test(n.tag) || n.attributes.role === 'heading');
  const caption = (title ?? nodes[0])?.content.flatMap(part => 'text' in part ? part.text.trim() : []).join(' ').trim();
  const name = root.getAttribute('aria-label') || (caption && /[^*\s]/.test(caption) && caption.length <= 80 ? caption : '') || root.getAttribute('id') || `${root.localName} component`;
  return readComponent({ format: 'walkthrough-component', version: 1, id: crypto.randomUUID(), name: name.slice(0, 100), createdAt: new Date().toISOString(), source, width: Math.ceil(rect.width), height: Math.ceil(rect.height), background, nodes, truncated });
}

/** Resolve user edits while keeping the captured nodes unchanged. */
export function componentNode(component: SavedComponent, nodeId: number): ComponentNode {
  const node = component.nodes[nodeId];
  if (!node) throw new Error('Component layer not found.');
  const edit = component.edits?.[nodeId];
  if (!edit) return node;
  let index = 0;
  // Edited shorthands must follow the captured longhands in CSS order.
  return { ...node,
    styles: { ...Object.fromEntries(Object.entries(node.styles).filter(([key]) => !Object.hasOwn(edit.styles ?? {}, key))), ...edit.styles },
    content: node.content.map(part => 'text' in part ? { text: edit.text?.[index++] ?? part.text } : part),
  };
}

export function componentIsDirty(component: SavedComponent, saved?: SavedComponent): boolean {
  return !saved || component.name !== saved.name || JSON.stringify(component.edits ?? {}) !== JSON.stringify(saved.edits ?? {});
}

/** Only allowlisted DOM and style values are built, never executable source HTML. */
export function renderComponent(doc: Document, value: SavedComponent): HTMLElement | SVGElement {
  const component = readComponent(value);
  const nodes = component.nodes.map(node => componentNode(component, node.nodeId));
  const elements = nodes.map(node => {
    const element = node.svg ? doc.createElementNS('http://www.w3.org/2000/svg', node.tag) : doc.createElement(node.tag);
    for (const [name, value] of Object.entries(node.attributes)) element.setAttribute(name, value);
    element.setAttribute('data-component-node', String(node.nodeId));
    for (const [name, value] of Object.entries(node.styles)) element.style.setProperty(name, value);
    element.style.setProperty('animation', 'none', 'important');
    element.style.setProperty('transition', 'none', 'important');
    return element;
  });
  const pseudo = doc.createElement('style');
  pseudo.dataset.componentStyle = '';
  for (const node of nodes) {
    const element = elements[node.nodeId]!;
    for (const part of node.content) element.append('text' in part ? doc.createTextNode(part.text) : elements[part.nodeId]!);
    for (const type of ['before', 'after'] as const) if (node[type]) {
      const rule = doc.createElement('span');
      for (const [key, value] of Object.entries(node[type])) rule.style.setProperty(key, value);
      rule.style.setProperty('animation', 'none', 'important');
      pseudo.textContent += `[data-component-node="${node.nodeId}"]::${type}{${rule.style.cssText}}`;
    }
  }
  const root = elements[0]!;
  // Detach page placement while preserving the selected box and every descendant's styles.
  for (const [name, value] of Object.entries({ position: 'relative', inset: 'auto', margin: '0px', float: 'none', transform: 'none', translate: 'none', rotate: 'none', scale: 'none', 'box-sizing': 'border-box', width: `${component.width}px`, height: `${component.height}px`, 'max-width': 'none', 'max-height': 'none', 'min-width': '0px', 'min-height': '0px', flex: 'none' })) root.style.setProperty(name, value, 'important');
  for (const [name, value] of Object.entries(component.edits?.[0]?.styles ?? {})) root.style.setProperty(name, value, 'important');
  doc.head.append(pseudo);
  doc.body.replaceChildren(root);
  return root;
}

export function componentCss(component: SavedComponent, nodeId: number): string {
  const node = componentNode(component, nodeId);
  return `.component-node-${nodeId} {\n${Object.entries(node.styles).map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}\n`;
}
