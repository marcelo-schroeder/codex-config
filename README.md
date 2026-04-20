# codex-config

Personal Codex configuration source of truth.

This repo manages:

- `skills/` as skill directories synced into `~/.codex/skills/`
- `agents/` as standalone custom-agent TOML files synced into `~/.codex/agents/`
- `scripts/` as local sync helpers

## Sync

Use the generic sync script to install or refresh the managed symlinks:

```bash
./scripts/sync_codex_config.sh
```

Preview changes without mutating anything:

```bash
./scripts/sync_codex_config.sh --dry-run
```

By default, the script syncs into `~/.codex`. Override that with `--codex-home <path>` if needed.

Skills are symlinked as directories. Custom agents are symlinked individually as top-level TOML files under `~/.codex/agents/`.

## Layout

```text
skills/<skill-name>/...
agents/<agent-name>.toml
scripts/sync_codex_config.sh
```
