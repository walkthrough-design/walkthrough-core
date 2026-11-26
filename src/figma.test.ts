import { expect, test } from 'bun:test';
import { figmaSvg, readFigmaSnapshot, type FigmaSnapshot } from './figma';

const selection: FigmaSnapshot = { format: 'walkthrough-figma', version: 1, name: 'Menu', source: { recordingId: 'recording', recordingName: 'Flow', url: 'https://example.com', at: 1200, nodeId: 42, selector: '#menu', provenance: 'recomputed' }, width: 200, height: 80, warnings: [], layers: [{ kind: 'box', parent: null, name: 'Menu', x: 0, y: 0, width: 200, height: 80, opacity: 1 }] };

test('Figma payload rejects invalid geometry, hierarchy, executable SVG and remote assets', () => {
  expect(readFigmaSnapshot(selection).source.at).toBe(1200);
  for (const changed of [{ width: Infinity }, { opacity: -1 }, { parent: 0 }, { kind: 'script' }, { kind: 'image', png: 'https://attacker.test/image.png' }, { kind: 'svg', svg: { nodes: [{ tag: 'script' }] } }]) expect(() => readFigmaSnapshot({ ...selection, layers: [{ ...selection.layers[0], ...changed }] })).toThrow();
  expect(() => readFigmaSnapshot({ ...selection, layers: Array(513).fill(selection.layers[0]) })).toThrow();
  expect(() => readFigmaSnapshot({ ...selection, extra: 'x'.repeat(4 * 1024 * 1024) })).toThrow();
});

test('Figma sandbox validation works without browser TextEncoder and safely serializes SVG', () => {
  const svg = { format: 'walkthrough-component' as const, version: 1 as const, id: 'icon', name: 'Icon', createdAt: new Date().toISOString(), source: selection.source, width: 20, height: 20, background: 'transparent', truncated: false, nodes: [{ nodeId: 0, parentId: null, tag: 'svg', svg: true, attributes: { viewBox: '0 0 20 20' }, styles: { fill: 'rgb(0, 0, 0)', opacity: '0.5' }, content: [{ text: '<script>&"' }] }] };
  const encoder = globalThis.TextEncoder;
  try {
    Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: undefined });
    expect(readFigmaSnapshot({ ...selection, name: 'Türkçe 😀' }).name).toBe('Türkçe 😀');
    const markup = figmaSvg(svg);
    expect(markup).toContain('&lt;script&gt;&amp;&quot;');
    expect(markup).not.toContain('opacity:0.5');
    expect(() => figmaSvg({ ...svg, nodes: [{ ...svg.nodes[0], attributes: { href: 'https://attacker.test/' } }] })).toThrow();
  } finally { Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: encoder }); }
});
