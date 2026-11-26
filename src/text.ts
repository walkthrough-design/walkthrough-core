export const MAX_TEXT_LENGTH = 2048;
export interface TextEdit { before: string[]; after: string[] }

export function validTextParts(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 && value.every(part => typeof part === 'string' && part.length <= MAX_TEXT_LENGTH) && value.reduce((sum, part) => sum + part.length, 0) <= 8192;
}

export function validTextEdits(value: unknown): value is Record<string, TextEdit> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 256) return false;
  let size = 0;
  for (const [id, edit] of Object.entries(value)) {
    if (!/^(0|[1-9]\d{0,9})$/.test(id) || !edit || typeof edit !== 'object' || !validTextParts(edit.before) || !validTextParts(edit.after) || !edit.before.length || edit.before.length !== edit.after.length) return false;
    size += [...edit.before, ...edit.after].reduce((sum, part) => sum + part.length, 0);
    if (size > 100_000) return false;
  }
  return true;
}

export function editableText(element: Element): string[] {
  if (element.closest('script,style,head,textarea,input,select,[contenteditable],.rr-mask,[data-private],.rr-block,[data-walkthrough-block]')) return [];
  const parts = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent ?? '');
  return validTextParts(parts) && parts.some(part => part.trim()) ? parts : [];
}

/** Edit existing text nodes so child elements and rrweb's node identities stay intact. */
export function previewText(element: Element, edit: TextEdit): (() => void) | null {
  const original = editableText(element);
  if (!original.length || original.length !== edit.before.length || edit.after.length !== original.length || !original.every((part, index) => part === edit.before[index])) return null;
  const nodes = [...element.childNodes].filter(node => node.nodeType === 3);
  nodes.forEach((node, index) => { node.textContent = edit.after[index]!; });
  return () => nodes.forEach((node, index) => { node.textContent = original[index]!; });
}
