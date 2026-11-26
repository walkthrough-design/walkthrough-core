import type { eventWithTime } from '@rrweb/types';
import type { TextEdit } from './text';
export type { eventWithTime } from '@rrweb/types';

export const STYLE_PROPERTIES = ['display', 'visibility', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'box-sizing', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'grid-template-columns', 'grid-template-rows', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'border-radius', 'border-width', 'border-style', 'border-color', 'padding', 'margin', 'gap', 'box-shadow', 'opacity', 'transform', 'transition-property', 'transition-duration', 'transition-timing-function', 'animation-name', 'animation-duration', 'animation-timing-function'] as const;
export const MAX_STRUCTURE_NODES = 256;
export const SEMANTIC_ATTRIBUTES = ['id', 'role', 'aria-controls', 'aria-owns', 'aria-expanded', 'aria-haspopup', 'aria-hidden', 'aria-labelledby', 'tabindex', 'type', 'hidden', 'open', 'data-state'] as const;
export const CONTROL_KEYS = ['Escape', 'Enter', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;
export type ControlKey = typeof CONTROL_KEYS[number];

export interface ElementEvidence {
  nodeId: number;
  tag: string;
  selector: string;
  label: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  states: string[];
  animations: { name: string; keyframes: Record<string, string | number | null>[]; duration: number; delay: number; easing: string; iterations: number; infinite?: boolean }[];
  attributes?: Record<string, string>;
}

export interface StructureNode {
  nodeId: number;
  parentId: number | null;
  tag: string;
  text: string;
  content?: ({ text: string } | { nodeId: number })[];
  attributes: Record<string, string>;
  styles: Record<string, string>;
}
export interface CapturedStructure { nodes: StructureNode[]; truncated: boolean }
export interface PanelEvidence {
  relation: 'aria-controls' | 'aria-owns';
  targetId: string;
  element: ElementEvidence;
  structure?: CapturedStructure;
}

export interface Observation {
  at: number;
  eventAt?: number;
  trigger: string;
  element: ElementEvidence;
  key?: ControlKey;
  panel?: PanelEvidence;
}

export interface Recording {
  format: 'walkthrough';
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  source: { url: string; title: string; viewport: { width: number; height: number } };
  events: eventWithTime[];
  observations: Observation[];
  duration: number;
  complete: boolean;
  gaps: string[];
}

export interface CaptureBatch {
  sessionId: string;
  documentId?: string;
  sequence: number;
  events: eventWithTime[];
  observations: Observation[];
  elapsed: number;
}

export type ExportFormat = 'code' | 'json' | 'prompt';
export interface ExportOptions { styles: boolean; animations: boolean; states: boolean; interactions: boolean; structure?: boolean }
export interface AgentBrief { task: string; target: string; constraints: string; instructions: string }
export const DEFAULT_AGENT_INSTRUCTIONS = 'Read the target repository instructions, components, design tokens, styles and tests first. Reuse the existing framework and component primitives. Make the smallest complete change. Preserve keyboard access, focus management and reduced-motion behavior. Add or update checks for the changed behavior. Run the relevant checks and report what passed, what you changed, and what remains unknown. Do not claim a check passed unless you ran it.';
export interface Selection {
  at: number;
  element: ElementEvidence;
  provenance: 'captured' | 'recomputed';
  capturedAt?: number;
  overrides: Record<string, string>;
  nodeOverrides?: Record<string, Record<string, string>>;
  text?: string[];
  textOverrides?: Record<string, TextEdit>;
  structure?: CapturedStructure;
  linkedPanel?: { at: number; element: ElementEvidence; structure: CapturedStructure; provenance: 'captured' | 'recomputed' };
  linkedTrigger?: { at: number; element: ElementEvidence; provenance: 'captured' | 'recomputed' };
}

export interface Remix {
  format: 'walkthrough-remix'; version: 1; id: string; name: string; createdAt: string;
  recordingId: string; recordingHash: string; selection: Selection; options: ExportOptions;
  task: string; target: string;
}

export interface InteractionContext {
  trigger: { at: number; element: ElementEvidence; provenance: 'captured' | 'recomputed' };
  panel: { at: number; element: ElementEvidence; structure?: CapturedStructure; structureAt?: number; structureProvenance?: 'captured' | 'recomputed'; provenance: 'captured' | 'recomputed' };
  relation: { type: 'aria-controls' | 'aria-owns' | 'user-selected'; targetId?: string; provenance: 'captured' | 'user-selected' };
  interval: { start: number; end: number };
  checkpoints: { at: number; state: 'open' | 'closed' | 'unknown'; element: ElementEvidence; panel?: ElementEvidence }[];
  events: Observation[];
  gaps: string[];
}

export * from './capture';
export * from './recording';
export * from './export';
export * from './replay';
export * from './interaction';
export * from './observer';
export * from './timeline';
export * from './motion';
export * from './text';

export * from "./component";
export * from "./community";
export * from './figma';
