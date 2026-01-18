<div align="center">
  <strong>dotagents</strong>
  <br />
  <em>One canonical .agents folder that powers all your AI tools.</em>

  <br /><br />
  <em>
    Simple setup • One source of truth • Safe to re-run anytime
  </em>
</div>

## Quick Start

Requirements: Bun 1.3+.

Run the guided TUI:
```bash
npx @iannuttall/dotagents
```

Or with Bun:
```bash
bunx @iannuttall/dotagents
```

Choose a workspace (Global home or Project folder) and follow the prompts. You can run it again anytime to repair links or undo changes.

Global home affects all projects. Project folder only affects the current directory you run dotagents from.

## What it does

- Keeps `.agents` as the source of truth.
- Creates symlinks for Claude, Codex, and Factory.
- Always creates a backup before any overwrite so changes are reversible.

## Where it links

`.agents/AGENTS.md` → `~/.claude/CLAUDE.md`

`.agents/commands` → `~/.claude/commands`

`.agents/commands` → `~/.factory/commands`

`.agents/commands` → `~/.codex/prompts`

`.agents/hooks` → `~/.claude/hooks`

`.agents/hooks` → `~/.factory/hooks`

`.agents/AGENTS.md` → `~/.factory/AGENTS.md`

`.agents/AGENTS.md` → `~/.codex/AGENTS.md`

`.agents/skills` → `~/.claude/skills`

`.agents/skills` → `~/.factory/skills`

`.agents/skills` → `~/.codex/skills`

## Development

Run the TUI in dev mode:
```bash
bun run dev
```

Type-check:
```bash
bun run type-check
```

Run tests:
```bash
bun test
```

Build the CLI:
```bash
bun run build
```

## Notes

- Cursor supports `.claude/commands` and `.claude/skills` (global or project). If `.claude` does not exist but `.cursor` does, dotagents also links `.agents/commands` → `.cursor/commands` and `.agents/skills` → `.cursor/skills`.
- Codex prompts always symlink to `.agents/commands` (canonical source).
- Skills require a valid `SKILL.md` with `name` + `description` frontmatter.
- Claude prompt precedence: if `.agents/CLAUDE.md` exists, it links to `.claude/CLAUDE.md`. Otherwise `.agents/AGENTS.md` is used. After adding or removing `.agents/CLAUDE.md`, re-run dotagents and apply/repair links to update the symlink. Factory/Codex always link to `.agents/AGENTS.md`.
- Project scope creates `.agents`, `.claude`, `.factory`, and `.codex` inside the project (same link layout as global).
- Backups are stored under `.agents/backup/<timestamp>` and can be restored from the TUI via “Undo last change.”

## License

MIT
