import type { eventWithTime } from '@rrweb/types';

// Replay never fetches original assets. Archiving assets is a later fidelity step.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'none'";
const remoteCss = (value: string) => value
  .replace(/@import\b(?:[^;"'\\]|\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')*(?:;|$)/gi, '')
  .replace(/url\s*\((?:[^"'\\)]|\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')*\)/gi, 'none');

export function sanitizeReplayEvents(events: eventWithTime[]): eventWithTime[] {
  const copy = structuredClone(events);
  for (const event of copy) {
    // A stripped iframe's document must not reopen and replace the top-level replay document.
    if (event.type === 3 && event.data.source === 0) event.data.adds = event.data.adds.filter(({ node }) => node.type !== 0);
  }
  let visited = 0;
  function visit(value: unknown, depth = 0): void {
    if (depth > 200 || ++visited > 5_000_000) throw new Error('Recording structure exceeds the replay limit.');
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    const node = value as Record<string, any>;
    if (typeof node.tagName === 'string') {
      if (['script', 'iframe', 'object', 'embed', 'base', 'meta'].includes(node.tagName.toLowerCase())) { node.tagName = 'div'; node.attributes = {}; node.childNodes = []; }
    }
    for (const key of Object.keys(node)) {
      if (key === 'attributes' && node[key] && typeof node[key] === 'object') {
        for (const attr of Object.keys(node[key])) {
          if (/^(on|src$|srcset$|srcdoc$|href$|xlink:href$|action$|formaction$|data$|poster$|ping$|background$)/i.test(attr)) delete node[key][attr];
          else if (typeof node[key][attr] === 'string') node[key][attr] = remoteCss(node[key][attr]);
        }
      }
      if (typeof node[key] === 'string' && ['textContent', 'cssText', '_cssText', 'rule', 'value'].includes(key)) node[key] = remoteCss(node[key]);
      if (key === 'styleDiff' && node[key] && typeof node[key] === 'object') for (const prop of Object.keys(node[key])) {
        if (typeof node[key][prop] === 'string') node[key][prop] = remoteCss(node[key][prop]);
        else if (Array.isArray(node[key][prop])) node[key][prop] = node[key][prop].map((part: unknown) => typeof part === 'string' ? remoteCss(part) : part);
      }
      visit(node[key], depth + 1);
    }
    if (node.tagName === 'head' && Array.isArray(node.childNodes)) node.childNodes.unshift({ type: 2, tagName: 'meta', attributes: { 'http-equiv': 'Content-Security-Policy', content: CSP }, childNodes: [], id: -999_999 });
  }
  visit(copy);
  return copy;
}
