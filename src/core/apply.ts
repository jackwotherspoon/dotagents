import fs from 'fs';
import path from 'path';
import type { LinkPlan, LinkTask, SourceKind } from './types.js';
import { copyDir, copyFile, ensureDir, ensureFile, removePath, pathExists } from '../utils/fs.js';

const DEFAULT_AGENTS = `# AGENTS\n\nAdd shared agent instructions here.\n`;

async function createSource(task: Extract<LinkTask, { type: 'ensure-source' }>): Promise<void> {
  if (task.kind === 'dir') {
    await ensureDir(task.path);
    return;
  }
  await ensureFile(task.path, DEFAULT_AGENTS);
}

function commonPath(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const splitPaths = paths.map((p) => path.resolve(p).split(path.sep));
  const minLen = Math.min(...splitPaths.map((parts) => parts.length));
  const shared: string[] = [];
  for (let i = 0; i < minLen; i += 1) {
    const segment = splitPaths[0]?.[i];
    if (!segment) break;
    if (splitPaths.every((parts) => parts[i] === segment)) {
      shared.push(segment);
    } else {
      break;
    }
  }
  if (shared.length === 0) return null;
  if (shared[0] === '') return path.sep + shared.slice(1).join(path.sep);
  return shared.join(path.sep);
}

function inferBackupDir(plan: LinkPlan): string | null {
  const sourceDirs = plan.tasks
    .map((task) => (task.type === 'ensure-source' ? task.path : task.source))
    .filter(Boolean)
    .map((p) => path.dirname(p));
  const root = commonPath(sourceDirs);
  if (!root) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(root, 'backup', timestamp);
}

async function backupTarget(target: string, backupDir: string): Promise<boolean> {
  if (!await pathExists(target)) return false;
  const stat = await fs.promises.lstat(target);
  if (stat.isSymbolicLink()) return false;

  const root = path.parse(target).root || path.sep;
  const rel = path.relative(root, target);
  const dest = path.join(backupDir, rel);
  await ensureDir(path.dirname(dest));

  try {
    await fs.promises.rename(target, dest);
    return true;
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
  }

  if (stat.isDirectory()) {
    await copyDir(target, dest, true);
  } else {
    await copyFile(target, dest, true);
  }
  await removePath(target);
  return true;
}

async function createLink(
  source: string,
  target: string,
  kind: SourceKind,
  force: boolean,
  backupDir?: string,
): Promise<{ created: boolean; backedUp: boolean }> {
  if (await pathExists(target)) {
    if (!force) return { created: false, backedUp: false };
    const backedUp = backupDir ? await backupTarget(target, backupDir) : false;
    await removePath(target);
    await ensureDir(path.dirname(target));
    const type = kind === 'dir' ? 'junction' : 'file';
    await fs.promises.symlink(source, target, type as fs.symlink.Type);
    return { created: true, backedUp };
  }
  await ensureDir(path.dirname(target));
  const type = kind === 'dir' ? 'junction' : 'file';
  await fs.promises.symlink(source, target, type as fs.symlink.Type);
  return { created: true, backedUp: false };
}

export async function applyLinkPlan(
  plan: LinkPlan,
  opts?: { force?: boolean; backupDir?: string },
): Promise<{ applied: number; skipped: number; conflicts: number; backupDir?: string; backedUp: number }> {
  const force = !!opts?.force;
  const backupDir = force ? (opts?.backupDir || inferBackupDir(plan) || undefined) : undefined;
  let applied = 0;
  let skipped = 0;
  let conflicts = 0;
  let backedUp = 0;

  for (const task of plan.tasks) {
    if (task.type === 'conflict') {
      conflicts += 1;
      if (force && task.target !== task.source && task.kind) {
        const result = await createLink(task.source, task.target, task.kind, true, backupDir);
        if (result.backedUp) backedUp += 1;
        applied += 1;
      }
      continue;
    }
    if (task.type === 'noop') {
      skipped += 1;
      continue;
    }
    if (task.type === 'ensure-source') {
      await createSource(task);
      applied += 1;
      continue;
    }
    if (task.type === 'link') {
      const before = await pathExists(task.target);
      const result = await createLink(task.source, task.target, task.kind, force, backupDir);
      if (result.backedUp) backedUp += 1;
      if (before && !force) skipped += 1; else applied += 1;
    }
  }

  return { applied, skipped, conflicts, backupDir, backedUp };
}
