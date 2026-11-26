import { componentNode, readComponent, type ComponentNode, type SavedComponent } from './component';

/** Emails, links, card-like numbers, phone-like numbers and common API key/token shapes. */
const PRIVATE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}|\b(?:https?:\/\/|www\.)\S+|\b(?:sk|pk|rk)_(?:live|test)_\w{6,}|\bgh[pousr]_\w{20,}|\bgithub_pat_\w{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abposr]-[\w-]{10,}|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bwt_[\w-]{16,}|\+?\d[\d ().-]{8,}\d/gi;
const REDACTED = '•••';
// Structural attributes only. id, class, title, alt, placeholder and aria-* can carry names or page copy.
const KEEP = new Set('role type disabled checked selected open colspan rowspan dir width height viewBox preserveAspectRatio d x y x1 y1 x2 y2 cx cy r rx ry points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity transform offset stop-color stop-opacity gradientUnits gradientTransform href clip-rule'.split(' '));

// Number runs count only with 10+ digits, so dates, prices and sizes stay.
export const redact = (text: string) => text.replace(PRIVATE, match => /^\+?\d/.test(match) && match.replace(/\D/g, '').length < 10 ? match : REDACTED);
const styles = (value: Record<string, string>) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'content' ? redact(item) : item]));

/**
 * The public copy of a component: edits applied (the pre-edit text is dropped), no source page, URL, selector
 * or recording, identifying attributes removed and private-looking text replaced with •••.
 */
export function communityComponent(value: SavedComponent, id: string, name = value.name, createdAt = new Date().toISOString()): SavedComponent {
  const component = readComponent(value);
  const nodes: ComponentNode[] = component.nodes.map(original => {
    const node = componentNode(component, original.nodeId);
    return {
      nodeId: node.nodeId, parentId: node.parentId, tag: node.tag, svg: node.svg,
      attributes: Object.fromEntries(Object.entries(node.attributes).filter(([key]) => KEEP.has(key))),
      styles: styles(node.styles),
      content: node.content.map(part => 'text' in part ? { text: redact(part.text) } : part),
      ...(node.before ? { before: styles(node.before) } : {}), ...(node.after ? { after: styles(node.after) } : {}),
    };
  });
  return readComponent({
    format: 'walkthrough-component', version: 1, id, name: redact(name.trim()).slice(0, 100) || 'Untitled component', createdAt,
    source: { recordingId: 'community', recordingName: 'Community', url: '', at: 0, nodeId: 0, selector: '', provenance: 'recomputed' },
    width: component.width, height: component.height, background: component.background, nodes, truncated: component.truncated,
  });
}
