import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { captureElement, getReplaySteps, parseRecording, type Recording } from './index';

const window = new Window();
const document = window.document as unknown as Document;
const globals = { CSS: globalThis.CSS, NodeFilter: globalThis.NodeFilter };
beforeAll(() => Object.assign(globalThis, { CSS: window.CSS, NodeFilter: window.NodeFilter }));
afterAll(() => Object.assign(globalThis, globals));

function labelOf(html: string): string {
  document.body.innerHTML = html;
  return captureElement(document.querySelector('button')!, 4).label;
}

test('icon buttons are named by the visible text their aria-labelledby references', async () => {
  const example = await readFile(new URL('../examples/close-menu.json', import.meta.url), 'utf8');
  const recording = parseRecording(example);
  const observation = recording.observations[0]!;
  // Existing recordings keep their original evidence.
  expect(getReplaySteps(recording)[0]!.label).toBe('Click · button');

  document.body.innerHTML = '<button aria-labelledby="close-caption"></button><span id="close-caption">Close menu</span>';
  const element = captureElement(document.querySelector('button')!, 4);
  expect(element.label).toBe('Close menu');
  const captured: Recording = { ...recording, observations: [{ ...observation, element }] };
  expect(getReplaySteps(captured)[0]!.label).toBe('Click · Close menu');

  expect(labelOf('<button aria-labelledby="a b" aria-label="Dismiss"></button><span id="a">Close</span> <span id="b"> the\n menu </span>')).toBe('Close the menu');
  expect(labelOf('<span id="a">Close menu</span><button aria-labelledby="a"><svg><text>x</text></svg></button>')).toBe('Close menu');
});

test('missing, hidden, masked and blocked aria-labelledby text falls back without leaking', () => {
  const secret = 'Jane Doe';
  const fallbacks = [
    '<button aria-labelledby="missing"></button>',
    `<button aria-labelledby="a"></button><span id="a" class="rr-mask">${secret}</span>`,
    `<button aria-labelledby="a"></button><span id="a" class="rr-block">${secret}</span>`,
    `<button aria-labelledby="a"></button><div data-private><span id="a">${secret}</span></div>`,
    `<button aria-labelledby="a"></button><span id="a" data-walkthrough-block>${secret}</span>`,
    `<button aria-labelledby="a"></button><span id="a">Close <b data-private>${secret}</b></span>`,
    `<button aria-labelledby="a"></button><div contenteditable><span id="a">${secret}</span></div>`,
    `<button aria-labelledby="a"></button><textarea id="a">${secret}</textarea>`,
    `<button aria-labelledby="a b"></button><span id="a">Close</span><span id="b" class="rr-mask">${secret}</span>`,
    `<button aria-labelledby="a"></button><span id="a" hidden>${secret}</span>`,
    `<button aria-labelledby="a"></button><div style="display: none"><span id="a">${secret}</span></div>`,
    `<button aria-labelledby="a"></button><span id="a" style="visibility: hidden">${secret}</span>`,
  ];
  for (const html of fallbacks) expect(labelOf(html)).toBe('button');
  expect(labelOf(`<button aria-labelledby="a" aria-label="Close menu"></button><span id="a" class="rr-mask">${secret}</span>`)).toBe('Close menu');
  expect(labelOf(`<div class="rr-mask"><button aria-labelledby="a"></button></div><span id="a">Close menu</span>`)).toBe('button (masked)');
});
