import fs from 'fs';
import path from 'path';
import { resolveRoots } from './paths.js';
import type { RootOptions } from './paths.js';
import { backupPath, createBackupSession, finalizeBackup, loadBackupManifest } from './backup.js';
import type { BackupEntry, BackupManifest, BackupSession } from './backup.js';
import { ensureDir, pathExists, removePath } from '../utils/fs.js';

type RestoreResult = {
  restored: number;
  restoredBackups: number;
  removedCreated: number;
  removedSymlinks: number;
  backupDir: string;
  undoneDir: string;
};

async function listBackupDirs(canonicalRoot: string): Promise<string[]> {
  const root = path.join(canonicalRoot, 'backup');
  if (!await pathExists(root)) return [];
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
}

async function findLatestBackup(canonicalRoot: string): Promise<{ dir: string; manifest: BackupManifest } | null> {
  const dirs = await listBackupDirs(canonicalRoot);
  const manifests: { dir: string; manifest: BackupManifest }[] = [];
  for (const dir of dirs) {
    const manifest = await loadBackupManifest(dir);
    if (manifest) manifests.push({ dir, manifest });
  }
  if (!manifests.length) return null;
  manifests.sort((a, b) => a.manifest.createdAt.localeCompare(b.manifest.createdAt));
  return manifests[manifests.length - 1] || null;
}

async function restoreSymlink(entry: BackupEntry): Promise<void> {
  if (!entry.backupPath) return;
  const link = await fs.promises.readlink(entry.backupPath);
  await ensureDir(path.dirname(entry.originalPath));
  await fs.promises.symlink(link, entry.originalPath);
  await fs.promises.unlink(entry.backupPath);
}

async function restorePath(entry: BackupEntry): Promise<void> {
  if (entry.action === 'create') {
    await removePath(entry.originalPath);
    return;
  }
  if (!entry.backupPath) return;
  if (entry.kind === 'symlink') {
    await restoreSymlink(entry);
    return;
  }
  await ensureDir(path.dirname(entry.originalPath));
  try {
    await fs.promises.rename(entry.backupPath, entry.originalPath);
    return;
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
  }
  if (entry.kind === 'dir') {
    await fs.promises.cp(entry.backupPath, entry.originalPath, { recursive: true, force: true });
  } else {
    await fs.promises.copyFile(entry.backupPath, entry.originalPath);
  }
  await removePath(entry.backupPath);
}

async function backupExistingOriginals(entries: BackupEntry[], session: BackupSession): Promise<void> {
  for (const entry of entries) {
    if (!await pathExists(entry.originalPath)) continue;
    await backupPath(entry.originalPath, session);
  }
}

export async function undoLastChange(opts: RootOptions): Promise<RestoreResult> {
  const roots = resolveRoots(opts);
  const latest = await findLatestBackup(roots.canonicalRoot);
  if (!latest) throw new Error('No backups found to undo.');

  const undoSession = await createBackupSession({
    canonicalRoot: roots.canonicalRoot,
    scope: opts.scope,
    operation: 'undo',
  });

  const entries = latest.manifest.entries || [];
  await backupExistingOriginals(entries, undoSession);

  let restored = 0;
  let restoredBackups = 0;
  let removedCreated = 0;
  let removedSymlinks = 0;
  for (const entry of entries) {
    if (entry.action === 'create') {
      if (await pathExists(entry.originalPath)) {
        await restorePath(entry);
        restored += 1;
        removedCreated += 1;
        if (entry.kind === 'symlink') removedSymlinks += 1;
      }
      continue;
    }
    if (!entry.backupPath) continue;
    if (!await pathExists(entry.backupPath)) continue;
    await restorePath(entry);
    restored += 1;
    restoredBackups += 1;
  }

  await finalizeBackup(undoSession);

  return { restored, restoredBackups, removedCreated, removedSymlinks, backupDir: undoSession.dir, undoneDir: latest.dir };
}
