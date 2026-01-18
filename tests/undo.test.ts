import fs from 'fs';
import path from 'path';
import { test, expect } from 'bun:test';
import { buildLinkPlan } from '../src/core/plan.js';
import { applyLinkPlan } from '../src/core/apply.js';
import { createBackupSession, finalizeBackup } from '../src/core/backup.js';
import { undoLastChange } from '../src/core/undo.js';
import { makeTempDir, writeFile } from './helpers.js';

test('undo restores overwritten tool paths', async () => {
  const home = await makeTempDir('dotagents-home-');
  const codexPrompts = path.join(home, '.codex', 'prompts');
  await writeFile(path.join(codexPrompts, 'keep.md'), '# keep');

  const plan = await buildLinkPlan({ scope: 'global', homeDir: home });
  const backup = await createBackupSession({ canonicalRoot: path.join(home, '.agents'), scope: 'global', operation: 'test' });
  await applyLinkPlan(plan, { force: true, backup });
  await finalizeBackup(backup);

  const undo = await undoLastChange({ scope: 'global', homeDir: home });
  expect(undo.restored).toBeGreaterThan(0);

  const stat = await fs.promises.lstat(codexPrompts);
  expect(stat.isDirectory()).toBe(true);
  expect(stat.isSymbolicLink()).toBe(false);
  expect(fs.existsSync(path.join(codexPrompts, 'keep.md'))).toBe(true);
});
