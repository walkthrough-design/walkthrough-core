import { readComponent, type SavedComponent } from './component';

export const MAX_FIGMA_BYTES = 4 * 1024 * 1024;
export const MAX_FIGMA_LAYERS = 512;
export interface FigmaColor { r: number; g: number; b: number; a: number }
export interface FigmaLayer {
  parent: number | null; name: string; kind: 'box' | 'text' | 'svg' | 'image';
  x: number; y: number; width: number; height: number; opacity: number;
  fill?: FigmaColor; border?: { color: FigmaColor; width: number };
  radii?: [number, number, number, number]; clip?: boolean;
  shadow?: { color: FigmaColor; x: number; y: number; radius: number; spread: number };
  text?: { value: string; family: string; weight: number; italic: boolean; size: number; lineHeight: number; spacing: number; align: 'LEFT' | 'CENTER' | 'RIGHT'; decoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH' };
  svg?: SavedComponent;
  png?: string;
}
export interface FigmaSnapshot {
  format: 'walkthrough-figma'; version: 1; name: string;
  source: SavedComponent['source']; width: number; height: number;
  layers: FigmaLayer[]; warnings: string[];
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const color = (v: unknown) => object(v) && ['r', 'g', 'b', 'a'].every(key => number(v[key], 0, 1));

/** Validate again at the API and plugin boundaries; page content is never executable. */
export function readFigmaSnapshot(value: unknown): FigmaSnapshot {
  const fail = (): never => { throw new Error('Invalid Figma selection. Select a smaller visible component and try again.'); };
  if (!object(value) || value.format !== 'walkthrough-figma' || value.version !== 1 || !text(value.name, 100) || !value.name.trim() || !number(value.width, 1, 16_384) || !number(value.height, 1, 16_384) || !Array.isArray(value.layers) || !value.layers.length || value.layers.length > MAX_FIGMA_LAYERS || !Array.isArray(value.warnings) || value.warnings.length > 40 || !value.warnings.every((v: unknown) => text(v, 300))) return fail();
  const source = value.source;
  if (!object(source) || !text(source.recordingId, 128) || !text(source.recordingName, 300) || !text(source.url, 4096) || !text(source.selector, 2048) || !number(source.at, 0, 3_601_000) || !Number.isSafeInteger(source.nodeId) || source.nodeId < 0 || source.provenance !== 'recomputed') return fail();
  let textSize = 0;
  for (const [index, layer] of value.layers.entries()) {
    if (!object(layer) || !['box', 'text', 'svg', 'image'].includes(layer.kind) || !text(layer.name, 120) || !number(layer.x, -65_536, 65_536) || !number(layer.y, -65_536, 65_536) || !number(layer.width, 0.01, 16_384) || !number(layer.height, 0.01, 16_384) || !number(layer.opacity, 0, 1)) return fail();
    if (layer.parent !== null && (!Number.isInteger(layer.parent) || layer.parent < 0 || layer.parent >= index || value.layers[layer.parent].kind !== 'box')) return fail();
    if (layer.fill !== undefined && !color(layer.fill) || layer.clip !== undefined && typeof layer.clip !== 'boolean') return fail();
    if (layer.border !== undefined && (!object(layer.border) || !color(layer.border.color) || !number(layer.border.width, 0, 1000))) return fail();
    if (layer.radii !== undefined && (!Array.isArray(layer.radii) || layer.radii.length !== 4 || !layer.radii.every((v: unknown) => number(v, 0, 16_384)))) return fail();
    if (layer.shadow !== undefined && (!object(layer.shadow) || !color(layer.shadow.color) || !['x', 'y', 'spread'].every(key => number(layer.shadow[key], -1000, 1000)) || !number(layer.shadow.radius, 0, 1000))) return fail();
    if (layer.kind === 'text') {
      const t = layer.text;
      if (!object(t) || !text(t.value, 100_000) || !text(t.family, 200) || !number(t.weight, 1, 1000) || typeof t.italic !== 'boolean' || !number(t.size, 1, 1000) || !number(t.lineHeight, 1, 2000) || !number(t.spacing, -1000, 1000) || !['LEFT', 'CENTER', 'RIGHT'].includes(t.align) || !['NONE', 'UNDERLINE', 'STRIKETHROUGH'].includes(t.decoration)) return fail();
      textSize += t.value.length;
    } else if (layer.text !== undefined) return fail();
    if (layer.kind === 'svg') { readComponent(layer.svg); if (layer.svg.nodes[0].tag !== 'svg') return fail(); }
    else if (layer.svg !== undefined) return fail();
    if (layer.png !== undefined && (layer.kind !== 'image' || !text(layer.png, 2_800_000) || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(layer.png))) return fail();
  }
  const json = JSON.stringify(value);
  const bytes = typeof TextEncoder === 'undefined' ? encodeURIComponent(json).replace(/%[\da-f]{2}/gi, 'x').length : new TextEncoder().encode(json).byteLength;
  if (textSize > 100_000 || bytes > MAX_FIGMA_BYTES) return fail();
  return value as FigmaSnapshot;
}

/** Only serialized, allowlisted component nodes reach Figma's SVG parser. */
export function figmaSvg(value: SavedComponent): string {
  const component = readComponent(value);
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  function node(id: number): string {
    const item = component.nodes[id];
    const attributes = { ...item.attributes };
    if (!id) { attributes.xmlns = 'http://www.w3.org/2000/svg'; attributes.width = String(component.width); attributes.height = String(component.height); }
    const css = Object.entries(item.styles).filter(([key]) => /^(fill|stroke|color|opacity|font|text-anchor|dominant-baseline|visibility)/.test(key) && (id !== 0 || key !== 'opacity')).map(([key, value]) => `${key}:${value}`).join(';');
    return `<${item.tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')} style="${escape(css)}">${item.content.map(part => 'text' in part ? escape(part.text) : node(part.nodeId)).join('')}</${item.tag}>`;
  }
  return node(0);
}
