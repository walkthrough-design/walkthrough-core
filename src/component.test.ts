import { expect, test } from 'bun:test';
import { componentCss, componentIsDirty, componentNode, readComponent, type SavedComponent } from './component';

const component: SavedComponent = {
  format: 'walkthrough-component', version: 1, id: 'navigation', name: 'Navigation', createdAt: '2026-11-17T10:00:00Z',
  source: { recordingId: 'source', recordingName: 'Reference', url: 'https://example.com', at: 50, nodeId: 42, selector: 'nav', provenance: 'recomputed' },
  width: 240, height: 600, background: 'white', truncated: false,
  nodes: [
    { nodeId: 0, parentId: null, tag: 'nav', svg: false, attributes: { 'aria-label': 'Navigation' }, styles: { display: 'flex', color: 'rgb(20, 30, 40)' }, content: [{ text: 'Before ' }, { nodeId: 1 }, { text: ' after' }], before: { content: '"Menu"', color: 'red' } },
    { nodeId: 1, parentId: 0, tag: 'span', svg: false, attributes: {}, styles: { 'font-size': '14px' }, content: [{ text: 'Home' }] },
  ],
};

test('reads independent component layers, text order, pseudo styles and CSS without changing the source', () => {
  const original = JSON.stringify(component);
  const read = readComponent(JSON.parse(original));
  expect(read.nodes[0]!.content).toEqual(component.nodes[0]!.content);
  expect(read.nodes[0]!.before?.content).toBe('"Menu"');
  expect(componentCss(read, 1)).toContain('font-size: 14px;');
  expect(() => componentCss(read, 99)).toThrow('layer not found');
  expect(JSON.stringify(component)).toBe(original);
});

test('rejects executable markup, resource requests, invalid trees and oversized component data', () => {
  const mutations: ((copy: SavedComponent) => void)[] = [
    c => { c.nodes[0]!.tag = 'script'; },
    c => { c.nodes[0]!.attributes.onclick = 'alert(1)'; },
    c => { c.nodes[0]!.attributes.href = 'javascript:alert(1)'; },
    c => { c.nodes[0]!.attributes.fill = 'url(https://example.com/private)'; },
    c => { c.nodes[0]!.styles.background = 'url(https://example.com/private)'; },
    c => { c.nodes[0]!.styles.background = 'u\\72l(https://example.com/private)'; },
    c => { c.nodes[0]!.before = { content: '"</style><script>alert(1)</script>"' }; },
    c => { c.nodes[0]!.content.push({ nodeId: 1 }); },
    c => { c.nodes[0]!.content = []; },
    c => { c.nodes[1]!.parentId = 1; },
    c => { c.nodes[0]!.content = [{ nodeId: 0 }]; },
    c => { c.nodes[1]!.nodeId = 4; },
    c => { c.nodes[1]!.content = [{ text: 'x'.repeat(100_001) }]; },
    c => { c.source.selector = 'x'.repeat(4 * 1024 * 1024); },
    c => { c.width = Infinity; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(component); mutate(copy); expect(() => readComponent(copy)).toThrow('Invalid component'); }
  const svg = structuredClone(component);
  svg.nodes[1] = { ...svg.nodes[1]!, svg: true, tag: 'path', attributes: { d: 'M0 0L10 10', fill: 'url(#paint)' }, content: [] };
  expect(readComponent(svg).nodes[1]!.attributes.fill).toBe('url(#paint)');
});

test('keeps component edits separate, exports edited styles and validates imported patches', () => {
  const original = JSON.stringify(component);
  const edited = readComponent({ ...component, edits: {
    0: { styles: { color: 'blue', padding: '24px' }, text: ['Build <img src=x> ', ''] },
    1: { text: ['Workspace'] },
  } });
  expect(componentIsDirty(edited, component)).toBe(true);
  expect(componentIsDirty(edited, readComponent(JSON.parse(JSON.stringify(edited))))).toBe(false);
  expect(componentIsDirty({ ...component, edits: {} }, component)).toBe(false);
  expect(componentNode(edited, 0).content).toEqual([{ text: 'Build <img src=x> ' }, { nodeId: 1 }, { text: '' }]);
  expect(componentNode(edited, 1).content).toEqual([{ text: 'Workspace' }]);
  expect(componentCss(edited, 0)).toContain('color: blue;');
  expect(componentCss(edited, 0)).toContain('padding: 24px;');
  expect(componentCss(edited, 0).endsWith('\n}\n')).toBe(true);
  expect(componentNode(edited, 0).before).toEqual(component.nodes[0]!.before);
  expect(JSON.stringify(component)).toBe(original);
  expect(edited.nodes).toEqual(component.nodes);
  for (const edits of [
    null, [], { 99: { text: ['unknown'] } }, { '01': { text: ['alias'] } },
    { 0: { text: ['missing slot'] } }, { 0: { text: ['x'.repeat(2049), ''] } },
    { 0: { text: [42, ''] } }, { 0: { content: '<script>' } },
    { 0: { styles: { background: 'url(https://example.com)' } } },
    { 0: { styles: { color: 'red;display:none' } } },
    { 0: { styles: { color: 'u\\72l(https://example.com)' } } },
  ]) expect(() => readComponent({ ...component, edits })).toThrow('Invalid component');
});
