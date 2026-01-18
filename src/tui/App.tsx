import React, { useEffect, useMemo, useState } from 'react';
import fs from 'fs';
import path from 'path';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { buildLinkPlan } from '../core/plan.js';
import { getLinkStatus } from '../core/status.js';
import { applyMigration, scanMigration } from '../core/migrate.js';
import { resolveRoots } from '../core/paths.js';
import { createBackupSession, finalizeBackup } from '../core/backup.js';
import { undoLastChange } from '../core/undo.js';
import { preflightBackup } from '../core/preflight.js';
import type { Scope, LinkPlan, LinkStatus } from '../core/types.js';
import type { MigrationPlan, MigrationCandidate } from '../core/migrate.js';
import { HelpBar } from './ui/HelpBar.js';
import { ScrollArea } from './ui/ScrollArea.js';
import { Screen } from './ui/Screen.js';

const appTitle = 'dotagents';

type Step =
  | 'scope'
  | 'action'
  | 'status'
  | 'applying'
  | 'confirm-change'
  | 'migrate-choice'
  | 'done';

export const App: React.FC = () => {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('scope');
  const [scope, setScope] = useState<Scope | null>(null);
  const [plan, setPlan] = useState<LinkPlan | null>(null);
  const [status, setStatus] = useState<LinkStatus[]>([]);
  const [message, setMessage] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [migratePlan, setMigratePlan] = useState<MigrationPlan | null>(null);
  const [migrateIndex, setMigrateIndex] = useState<number>(0);
  const [migrateSelections, setMigrateSelections] = useState<Map<string, MigrationCandidate | null>>(new Map());
  const [changePlan, setChangePlan] = useState<{ migrate: MigrationPlan; link: LinkPlan; backupDir: string; timestamp: string } | null>(null);
  const [forceLinks, setForceLinks] = useState<boolean>(false);
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [conflictsOnly, setConflictsOnly] = useState<boolean>(false);
  const { stdout } = useStdout();

  useInput((input, key) => {
    if (input === 'q') exit();
    if (step === 'status' && input === 'd') setShowDetails((prev) => !prev);
    if (step === 'status' && input === 'c') setConflictsOnly(true);
    if (step === 'status' && input === 'a') setConflictsOnly(false);
    if (key.escape) {
      if (step === 'action') return setStep('scope');
      if (step === 'status') return setStep('action');
      if (step === 'confirm-change') return setStep('action');
      if (step === 'migrate-choice') {
        setMigratePlan(null);
        setMigrateSelections(new Map());
        setChangePlan(null);
        setForceLinks(false);
        return setStep('action');
      }
      if (step === 'done') return setStep('action');
    }
    if (step === 'done' && key.return) setStep('action');
  });

  const scopeLabel = scope === 'global' ? 'Global (~/.agents)' : scope === 'project' ? 'Project (.agents)' : '';

  const refreshStatus = async (nextScope: Scope) => {
    const s = await getLinkStatus({ scope: nextScope });
    setStatus(s);
    const p = await buildLinkPlan({ scope: nextScope });
    setPlan(p);
  };

  useEffect(() => {
    if (scope) void refreshStatus(scope);
  }, [scope]);

  const conflicts = plan?.conflicts.length || 0;
  const changes = plan?.changes.length || 0;

  const actionItems = useMemo(() => {
    const items = [] as { label: string; value: string }[];
    if (changes > 0) items.push({ label: `Switch ${changes} changes to .agents`, value: 'change' });
    items.push({ label: 'View status', value: 'view-status' });
    items.push({ label: 'Undo last change', value: 'undo' });
    items.push({ label: 'Exit', value: 'exit' });
    return items;
  }, [changes]);

  const mergeAgentStatus = (items: LinkStatus[]) => {
    const claudeEntry = items.find((s) => s.name === 'claude-md') || null;
    const agentsEntry = items.find((s) => s.name === 'agents-md') || null;
    if (!claudeEntry && !agentsEntry) return items;

    const merged: LinkStatus = {
      name: 'agents-md',
      source: claudeEntry?.source || agentsEntry?.source || '',
      targets: [
        ...(claudeEntry?.targets || []),
        ...(agentsEntry?.targets || []),
      ],
    };

    const withoutAgents = items.filter((s) => s.name !== 'claude-md' && s.name !== 'agents-md');
    return [merged, ...withoutAgents];
  };

  const displayName = (entry: LinkStatus) => {
    if (entry.name === 'agents-md') {
      const sourceFile = path.basename(entry.source);
      if (sourceFile === 'CLAUDE.md') return 'AGENTS.md (Claude override)';
      return 'AGENTS.md';
    }
    return entry.name;
  };

  const displayStatus = useMemo(() => mergeAgentStatus(status), [status]);

  const statusSummary = useMemo(() => {
    return displayStatus.map((s) => {
      const linked = s.targets.filter((t) => t.status === 'linked').length;
      const missing = s.targets.filter((t) => t.status === 'missing').length;
      const conflict = s.targets.filter((t) => t.status === 'conflict').length;
      return { name: displayName(s), linked, missing, conflict };
    });
  }, [displayStatus]);

  const summaryTable = useMemo(() => {
    const rows = statusSummary.map((s) => ({
      name: s.name,
      conflict: String(s.conflict),
      missing: String(s.missing),
      linked: String(s.linked),
    }));
    const header = { name: 'Section', conflict: 'Conflicts', missing: 'Need link', linked: 'Linked' };
    const width = {
      name: Math.max(header.name.length, ...rows.map((r) => r.name.length)),
      conflict: Math.max(header.conflict.length, ...rows.map((r) => r.conflict.length)),
      missing: Math.max(header.missing.length, ...rows.map((r) => r.missing.length)),
      linked: Math.max(header.linked.length, ...rows.map((r) => r.linked.length)),
    };
    const pad = (value: string, len: number) => value.padEnd(len, ' ');
    const lines = [
      `${pad(header.name, width.name)}  ${pad(header.conflict, width.conflict)}  ${pad(header.missing, width.missing)}  ${pad(header.linked, width.linked)}`,
      ...rows.map((r) => `${pad(r.name, width.name)}  ${pad(r.conflict, width.conflict)}  ${pad(r.missing, width.missing)}  ${pad(r.linked, width.linked)}`),
    ];
    return lines;
  }, [statusSummary]);

  const [conflictDetails, setConflictDetails] = useState<Map<string, { reason: string; contents?: string }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!plan) return;
      const map = new Map<string, { reason: string; contents?: string }>();
      for (const task of plan.conflicts) {
        map.set(task.target, { reason: task.reason });
        try {
          const stat = await fs.promises.lstat(task.target);
          if (stat.isDirectory() && !stat.isSymbolicLink()) {
            const entries = await fs.promises.readdir(task.target);
            const shown = entries.slice(0, 6);
            const more = entries.length > 6 ? `… +${entries.length - 6} more` : '';
            const contents = entries.length === 0
              ? '(empty)'
              : `${shown.join(', ')}${more ? `, ${more}` : ''}`;
            map.set(task.target, { reason: task.reason, contents: `Contains: ${contents}` });
          }
        } catch {
          // Ignore errors reading conflict target
        }
      }
      if (!cancelled) setConflictDetails(map);
    };
    void load();
    return () => { cancelled = true; };
  }, [plan]);

  const renderStatusList = () => {
    const sections = displayStatus.map((s) => {
      const targets = conflictsOnly ? s.targets.filter((t) => t.status === 'conflict') : s.targets;
      if (conflictsOnly && targets.length === 0) return null;
      return (
        <Box key={s.name} flexDirection="column" marginTop={1}>
          <Text color="cyan">{displayName(s)}</Text>
          {targets.map((t) => (
            <Box key={t.path} flexDirection="column">
              <Text>
                {t.status === 'linked' ? '✓' : t.status === 'missing' ? '•' : '⚠'} {t.path}
              </Text>
              {showDetails && t.status === 'conflict' && conflictDetails.has(t.path) ? (
                <>
                  <Text color="red">  {conflictDetails.get(t.path)?.reason}</Text>
                  {conflictDetails.get(t.path)?.contents ? (
                    <Text dimColor>  {conflictDetails.get(t.path)?.contents}</Text>
                  ) : null}
                </>
              ) : null}
            </Box>
          ))}
        </Box>
      );
    }).filter(Boolean);

    if (!sections.length) {
      return (
        <Box marginTop={1}>
          <Text dimColor>No conflicts found.</Text>
        </Box>
      );
    }

    return <Box flexDirection="column">{sections}</Box>;
  };

  if (step === 'scope') {
    return (
      <Screen>
        <Text color="green">{appTitle}</Text>
        <Text>Choose a workspace:</Text>
        <SelectInput
          items={[
            { label: 'Global home', value: 'global' },
            { label: 'Project folder', value: 'project' },
            { label: 'Exit', value: 'exit' },
          ]}
          onSelect={(item) => {
            if (item.value === 'exit') return exit();
            setScope(item.value as Scope);
            setStep('action');
          }}
        />
      </Screen>
    );
  }

  if (step === 'action') {
    return (
      <Screen>
        <Text color="green">{appTitle}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>Scope: {scopeLabel}</Text>
          <Text>Pending changes: {changes} · Conflicts: {conflicts}</Text>
          {summaryTable.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>Choose an action:</Text>
          <SelectInput
            items={actionItems}
            onSelect={(item) => {
              if (item.value === 'exit') return exit();
              if (item.value === 'view-status') {
                setStep('status');
                return;
              }
              if (item.value === 'undo') {
                if (!scope) return;
                setBusy('Undoing last change...');
                setStep('applying');
                void (async () => {
                  try {
                    const result = await undoLastChange({ scope });
                    setMessage(`Restored ${result.restored} items. Backup: ${result.backupDir}`);
                    await refreshStatus(scope);
                    setStep('done');
                  } catch (err: any) {
                    setMessage(err?.message || String(err));
                    setStep('done');
                  } finally {
                    setBusy(null);
                  }
                })();
                return;
              }
              if (item.value === 'change') {
                if (!scope) return;
                setBusy('Scanning current setup...');
                setStep('applying');
                void (async () => {
                  try {
                    const roots = resolveRoots({ scope });
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const migrate = await scanMigration({ scope });
                    const link = await buildLinkPlan({ scope });
                    const backupDir = path.join(roots.canonicalRoot, 'backup', timestamp);
                    setChangePlan({ migrate, link, backupDir, timestamp });
                    setBusy(null);
                    setStep('confirm-change');
                  } catch (err: any) {
                    setMessage(err?.message || String(err));
                    setStep('done');
                  } finally {
                    setBusy(null);
                  }
                })();
              }
            }}
          />
          <HelpBar text="Use ↑↓ to navigate, Enter to select, Esc to go back, q to quit" />
        </Box>
      </Screen>
    );
  }

  if (step === 'status') {
    const listHeight = Math.max(6, (stdout?.rows ?? 24) - 8);
    return (
      <Screen>
        <Text color="green">{appTitle}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>Scope: {scopeLabel}</Text>
          <Text>Pending changes: {changes} · Conflicts: {conflicts}</Text>
          <Text dimColor>Legend: ✓ linked • need link ⚠ conflict</Text>
          <Text dimColor>
            Mode: {conflictsOnly ? 'Conflicts only' : 'All'} · Details: {showDetails ? 'On' : 'Off'}
          </Text>
        </Box>
        <ScrollArea height={listHeight}>
          {renderStatusList()}
        </ScrollArea>
        <HelpBar text="d: details · c: conflicts only · a: show all · Esc: back · q: quit" />
      </Screen>
    );
  }

  if (step === 'confirm-change' && changePlan) {
    const migrateAuto = changePlan.migrate.auto.length;
    const migrateConflicts = changePlan.migrate.conflicts.length;
    const linkConflicts = changePlan.link.conflicts.length;
    const linkChanges = changePlan.link.changes.length;
    const proceedAllLabel = linkConflicts > 0
      ? 'Apply changes + overwrite conflicts'
      : 'Apply changes';
    const proceedSkipLabel = linkConflicts > 0
      ? 'Apply changes only (leave conflicts)'
      : 'Apply changes';
    return (
      <Screen>
        <Text color="green">{appTitle}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>Switch all to .agents</Text>
          <Text dimColor>Will copy existing content into .agents and relink tool paths.</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text>Plan summary:</Text>
          <Text dimColor>Migration: {migrateAuto} auto · {migrateConflicts} conflicts (choose sources)</Text>
          <Text dimColor>Links: {linkChanges} safe changes · {linkConflicts} conflicts (existing files/dirs)</Text>
          <Text dimColor>Backup: {changePlan.backupDir}</Text>
          <Text dimColor>Undo: Use "Undo last change" after this completes.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <SelectInput
            items={[
              { label: proceedAllLabel, value: 'force' },
              ...(linkConflicts > 0 ? [{ label: proceedSkipLabel, value: 'skip' }] : []),
              { label: 'Back', value: 'back' },
            ]}
            onSelect={(item) => {
              if (item.value === 'back') {
                setChangePlan(null);
                return setStep('action');
              }
              if (!scope) return;
              const overwrite = item.value === 'force';
              setForceLinks(overwrite);
              if (changePlan.migrate.conflicts.length > 0) {
                setMigratePlan(changePlan.migrate);
                setMigrateIndex(0);
                setMigrateSelections(new Map());
                setStep('migrate-choice');
                return;
              }
              setBusy('Applying changes...');
              setStep('applying');
              void (async () => {
                try {
                  const roots = resolveRoots({ scope });
                  const backup = await createBackupSession({
                    canonicalRoot: roots.canonicalRoot,
                    scope,
                    operation: 'change-to-agents',
                    timestamp: changePlan.timestamp,
                  });
                  await preflightBackup({
                    backup,
                    linkPlan: changePlan.link,
                    migratePlan: changePlan.migrate,
                    selections: new Map(),
                    forceLinks: overwrite,
                  });
                  const result = await applyMigration(changePlan.migrate, new Map(), { scope, backup, forceLinks: overwrite });
                  await finalizeBackup(backup);
                  setMessage(`Changed ${result.copied} items. Backup: ${result.backupDir}`);
                  await refreshStatus(scope);
                  setStep('done');
                } catch (err: any) {
                  setMessage(err?.message || String(err));
                  setStep('done');
                } finally {
                  setBusy(null);
                  setChangePlan(null);
                }
              })();
            }}
          />
          <HelpBar text="Enter to confirm · Esc to cancel · q to quit" />
        </Box>
      </Screen>
    );
  }

  if (step === 'migrate-choice' && migratePlan) {
    const conflict = migratePlan.conflicts[migrateIndex];
    if (!conflict) {
      return (
        <Screen>
          <Text color="green">{appTitle}</Text>
          <Text dimColor>No conflicts to resolve.</Text>
          <HelpBar text="Esc: back · q: quit" />
        </Screen>
      );
    }
    const items = conflict.candidates.map((c) => ({
      label: c.label,
      value: c,
    }));
    return (
      <Screen>
        <Text color="green">{appTitle}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>Resolve conflict {migrateIndex + 1} of {migratePlan.conflicts.length}</Text>
          <Text dimColor>{conflict.label}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (!scope) return;
              const next = new Map(migrateSelections);
              next.set(conflict.targetPath, item.value as MigrationCandidate);
              setMigrateSelections(next);
              if (migrateIndex + 1 < migratePlan.conflicts.length) {
                setMigrateIndex(migrateIndex + 1);
                return;
              }
              setBusy('Migrating...');
              setStep('applying');
              void (async () => {
                try {
                  const roots = resolveRoots({ scope });
                  const timestamp = changePlan?.timestamp || new Date().toISOString().replace(/[:.]/g, '-');
                  const backup = await createBackupSession({
                    canonicalRoot: roots.canonicalRoot,
                    scope,
                    operation: 'change-to-agents',
                    timestamp,
                  });
                  await preflightBackup({
                    backup,
                    linkPlan: changePlan?.link || (await buildLinkPlan({ scope })),
                    migratePlan: migratePlan,
                    selections: next,
                    forceLinks,
                  });
                  const result = await applyMigration(migratePlan, next, { scope, backup, forceLinks });
                  await finalizeBackup(backup);
                  setMessage(`Changed ${result.copied} items. Backup: ${result.backupDir}`);
                  await refreshStatus(scope);
                } catch (err: any) {
                  setMessage(err?.message || String(err));
                } finally {
                  setBusy(null);
                  setMigratePlan(null);
                  setMigrateIndex(0);
                  setMigrateSelections(new Map());
                  setChangePlan(null);
                  setStep('done');
                }
              })();
            }}
          />
          <HelpBar text="Use ↑↓ to choose, Enter to select, Esc to cancel" />
        </Box>
      </Screen>
    );
  }

  if (step === 'applying') {
    return (
      <Screen>
        <Text color="yellow"><Spinner type="dots" /> {busy || 'Working...'}</Text>
      </Screen>
    );
  }

  if (step === 'done') {
    return (
      <Screen>
        <Text>{message || 'Done.'}</Text>
        <Text dimColor>Press Enter to continue, Esc to go back, or q to quit.</Text>
      </Screen>
    );
  }

  return null;
};
