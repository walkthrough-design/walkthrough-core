import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { MAX_RECORDING_BYTES, createExport, getReplaySteps, parseRecording, type Recording, type Selection } from './src/index';

const help = `Usage: bun run context recording.walkthrough.json [options]

Without --node, print recording details and up to 200 navigation steps.
--node <id>                  Export a captured element or controlled panel
--at <milliseconds>          Use its latest captured evidence at or before this time
--format <prompt|json|css>    Output format (default: prompt)
--task <text>                What the coding agent should implement
--target <path>              Existing component to adapt
--instructions-file <path>  Your agent instructions (up to 8,000 characters)

Output goes to stdout. This command reads local files; it makes no network or AI request.
It does not execute source scripts or modify a repository. Inspect the handoff before using it.
`;

export function capturedSelection(recording: Recording, nodeId: number, at = recording.duration): Selection {
  if (!Number.isInteger(nodeId) || nodeId < 0) throw new Error('Node must be a non-negative integer.');
  if (!Number.isFinite(at) || at < 0 || at > recording.duration) throw new Error('Time must be within the recording, in milliseconds.');
  let selection: Selection | undefined;
  for (const observation of recording.observations) {
    if (observation.at > at || selection && observation.at < selection.at) continue;
    const element = observation.element.nodeId === nodeId ? observation.element : observation.panel?.element.nodeId === nodeId ? observation.panel.element : undefined;
    if (element) selection = { at: observation.at, capturedAt: observation.at, element, provenance: 'captured', overrides: {} };
  }
  if (!selection) throw new Error('No captured evidence for that node at or before this time. Use the step index or export a replay selection from the Inspector.');
  return selection;
}

export async function runContext(args: string[]): Promise<string> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    node: { type: 'string' }, at: { type: 'string' }, format: { type: 'string', default: 'prompt' }, task: { type: 'string' }, target: { type: 'string' }, 'instructions-file': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) return help;
  if (positionals.length !== 1) throw new Error('Provide one recording file. Run bun run context --help for usage.');
  const path = positionals[0]!;
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_RECORDING_BYTES) throw new Error(`Expected a recording file under ${MAX_RECORDING_BYTES / 1024 / 1024} MB.`);
  if (!['prompt', 'json', 'css'].includes(values.format!)) throw new Error('Format must be prompt, json or css.');
  const recording = parseRecording(await readFile(path, 'utf8'));
  const at = values.at === undefined ? recording.duration : Number(values.at);
  if (!Number.isFinite(at) || at < 0 || at > recording.duration) throw new Error('Time must be within the recording, in milliseconds.');
  if (values.node === undefined) {
    const steps = getReplaySteps(recording);
    return JSON.stringify({ format: 'walkthrough-context-index', version: 1, recording: { id: recording.id, name: recording.name, source: recording.source, duration: recording.duration, complete: recording.complete }, stepCount: steps.length, truncated: steps.length > 200, steps: steps.slice(0, 200).map(step => ({ at: step.at, nodeId: step.observation.element.nodeId, panelNodeId: step.observation.panel?.element.nodeId, label: step.label })), gaps: recording.gaps }, null, 2);
  }
  const selection = capturedSelection(recording, Number(values.node), at);
  let instructions: string | undefined;
  if (values['instructions-file']) {
    const info = await stat(values['instructions-file']);
    if (!info.isFile() || info.size > 32_000) throw new Error('Instructions file exceeds the supported size.');
    instructions = await readFile(values['instructions-file'], 'utf8');
    if (instructions.length > 8000) throw new Error('Instructions must be at most 8,000 characters.');
  }
  return createExport(recording, selection, values.format === 'css' ? 'code' : values.format as 'prompt' | 'json', { structure: true, styles: true, animations: true, states: true, interactions: true }, { task: values.task, target: values.target, instructions });
}

export async function main() {
  try { process.stdout.write(`${await runContext(process.argv.slice(2))}\n`); }
  catch (error) { process.stderr.write(`Walkthrough: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
if (import.meta.main) await main();
