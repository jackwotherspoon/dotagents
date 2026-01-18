import path from 'path';
import type { Mapping, Scope } from './types.js';
import { resolveRoots } from './paths.js';
import { pathExists } from '../utils/fs.js';

export type MappingOptions = {
  scope: Scope;
  projectRoot?: string;
  homeDir?: string;
};

export async function getMappings(opts: MappingOptions): Promise<Mapping[]> {
  const roots = resolveRoots(opts);
  const canonical = roots.canonicalRoot;
  const claudeOverride = path.join(canonical, 'CLAUDE.md');
  const agentsFallback = path.join(canonical, 'AGENTS.md');
  const agentsSource = await pathExists(claudeOverride) ? claudeOverride : agentsFallback;
  const hasClaude = await pathExists(roots.claudeRoot);
  const hasCursor = await pathExists(roots.cursorRoot);
  const includeCursor = !hasClaude && hasCursor;

  return [
    {
      name: 'claude-md',
      source: agentsSource,
      targets: [path.join(roots.claudeRoot, 'CLAUDE.md')],
      kind: 'file',
    },
    {
      name: 'agents-md',
      source: agentsFallback,
      targets: [
        path.join(roots.factoryRoot, 'AGENTS.md'),
        path.join(roots.codexRoot, 'AGENTS.md'),
      ],
      kind: 'file',
    },
    {
      name: 'commands',
      source: path.join(canonical, 'commands'),
      targets: [
        path.join(roots.claudeRoot, 'commands'),
        path.join(roots.factoryRoot, 'commands'),
        path.join(roots.codexRoot, 'prompts'),
        ...(includeCursor ? [path.join(roots.cursorRoot, 'commands')] : []),
      ],
      kind: 'dir',
    },
    {
      name: 'hooks',
      source: path.join(canonical, 'hooks'),
      targets: [
        path.join(roots.claudeRoot, 'hooks'),
        path.join(roots.factoryRoot, 'hooks'),
      ],
      kind: 'dir',
    },
    {
      name: 'skills',
      source: path.join(canonical, 'skills'),
      targets: [
        path.join(roots.claudeRoot, 'skills'),
        path.join(roots.factoryRoot, 'skills'),
        path.join(roots.codexRoot, 'skills'),
        ...(includeCursor ? [path.join(roots.cursorRoot, 'skills')] : []),
      ],
      kind: 'dir',
    },
  ];
}
