import fs from 'fs';
import path from 'path';
import type { Scope } from './types.js';
import { copyDir, copyFile, ensureDir, pathExists, removePath } from '../utils/fs.js';

export type BackupEntry = {
  originalPath: string;
  backupPath?: string;
  kind: 'file' | 'dir' | 'symlink';
  action: 'backup' | 'create';
};

export type BackupManifest = {
  version: 1;
  createdAt: string;
  scope: Scope;
  operation: string;
  entries: BackupEntry[];
};

export type BackupSession = {
  dir: string;
  manifestPath: string;
  createdAt: string;
  scope: Scope;
  operation: string;
  entries: BackupEntry[];
  _seen: Set<string>;
};

const MANIFEST_NAME = 'manifest.json';

export function backupPathFor(target: string, backupRoot: string): string {
  const root = path.parse(target).root || path.sep;
  const rel = path.relative(root, target);
  return path.join(backupRoot, rel);
}

function hasParentPath(target: string, seen: Set<string>): boolean {
  const resolved = path.resolve(target);
  for (const parent of seen) {
    if (resolved === parent) return true;
    if (resolved.startsWith(parent + path.sep)) return true;
  }
  return false;
}

async function backupSymlink(target: string, dest: string): Promise<void> {
  const link = await fs.promises.readlink(target);
  await ensureDir(path.dirname(dest));
  await fs.promises.symlink(link, dest);
  await fs.promises.unlink(target);
}

async function backupPathImpl(target: string, dest: string, kind: 'file' | 'dir' | 'symlink'): Promise<void> {
  await ensureDir(path.dirname(dest));
  try {
    await fs.promises.rename(target, dest);
    return;
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
  }

  if (kind === 'dir') {
    await copyDir(target, dest, true);
  } else {
    await copyFile(target, dest, true);
  }
  await removePath(target);
}

export async function createBackupSession(opts: { canonicalRoot: string; scope: Scope; operation: string; timestamp?: string }): Promise<BackupSession> {
  const timestamp = opts.timestamp || new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(opts.canonicalRoot, 'backup', timestamp);
  await ensureDir(dir);
  return {
    dir,
    manifestPath: path.join(dir, MANIFEST_NAME),
    createdAt: new Date().toISOString(),
    scope: opts.scope,
    operation: opts.operation,
    entries: [],
    _seen: new Set(),
  };
}

export async function backupPath(target: string, session: BackupSession): Promise<boolean> {
  if (!await pathExists(target)) return false;
  const resolved = path.resolve(target);
  if (hasParentPath(resolved, session._seen)) return false;

  const stat = await fs.promises.lstat(target);
  const kind: BackupEntry['kind'] = stat.isSymbolicLink()
    ? 'symlink'
    : stat.isDirectory()
      ? 'dir'
      : 'file';
  const dest = backupPathFor(target, session.dir);

  if (stat.isSymbolicLink()) {
    await backupSymlink(target, dest);
  } else {
    await backupPathImpl(target, dest, kind);
  }

  session.entries.push({ originalPath: resolved, backupPath: dest, kind, action: 'backup' });
  session._seen.add(resolved);
  return true;
}

export function recordCreatedPath(target: string, kind: BackupEntry['kind'], session: BackupSession): void {
  const resolved = path.resolve(target);
  if (hasParentPath(resolved, session._seen)) return;
  session.entries.push({ originalPath: resolved, kind, action: 'create' });
  session._seen.add(resolved);
}

export async function finalizeBackup(session: BackupSession): Promise<void> {
  const manifest: BackupManifest = {
    version: 1,
    createdAt: session.createdAt,
    scope: session.scope,
    operation: session.operation,
    entries: session.entries,
  };
  await fs.promises.writeFile(session.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

export async function loadBackupManifest(dir: string): Promise<BackupManifest | null> {
  const manifestPath = path.join(dir, MANIFEST_NAME);
  if (!await pathExists(manifestPath)) return null;
  const raw = await fs.promises.readFile(manifestPath, 'utf8');
  return JSON.parse(raw) as BackupManifest;
}
