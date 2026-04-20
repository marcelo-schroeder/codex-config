#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

info() {
  printf "${YELLOW}%s${NC}\n" "$*"
}

success() {
  printf "${GREEN}%s${NC}\n" "$*"
}

warn() {
  printf "${YELLOW}Warning: %s${NC}\n" "$*"
}

fail() {
  printf "${RED}Error: %s${NC}\n" "$*" >&2
  exit 1
}

usage() {
  cat <<USAGE
Sync repo-managed Codex skills and custom agents into ~/.codex.

Usage:
  $(basename "$0") [options]

Options:
  --codex-home <path>  Override the Codex home directory (default: ~/.codex)
  --dest <path>        Compatibility alias for the skills destination directory
  --dry-run            Show what would be changed without mutating anything
  -h, --help           Show this help message

Behavior:
  - creates ~/.codex/skills and ~/.codex/agents when missing
  - creates one symlink per directory under ./skills
  - creates one symlink per TOML file under ./agents
  - updates managed symlinks that point to the wrong source
  - removes stale managed symlinks whose source item no longer exists
  - leaves unrelated installed skills and agents untouched
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_SOURCE_DIR="$REPO_ROOT/skills"
AGENTS_SOURCE_DIR="$REPO_ROOT/agents"
CODEX_HOME="${HOME}/.codex"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --codex-home)
      [[ -n "${2:-}" ]] || fail "--codex-home requires a value"
      CODEX_HOME="$2"
      shift 2
      ;;
    --dest)
      [[ -n "${2:-}" ]] || fail "--dest requires a value"
      if [[ "$(basename "$2")" != "skills" ]]; then
        fail "--dest must point to a skills directory"
      fi
      CODEX_HOME="$(dirname "$2")"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

SKILLS_DEST_DIR="${CODEX_HOME}/skills"
AGENTS_DEST_DIR="${CODEX_HOME}/agents"

[[ -d "$SKILLS_SOURCE_DIR" ]] || fail "Skills source directory not found: $SKILLS_SOURCE_DIR"
[[ -d "$AGENTS_SOURCE_DIR" ]] || fail "Agents source directory not found: $AGENTS_SOURCE_DIR"

created=0
updated=0
unchanged=0
removed=0
conflicts=0

ensure_dir() {
  local dir="$1"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would ensure destination exists: $dir"
  else
    mkdir -p "$dir"
  fi
}

link_item() {
  local src="$1"
  local dest="$2"
  local label="$3"

  if [[ -L "$dest" ]]; then
    local current_target
    current_target="$(readlink "$dest")"

    if [[ "$current_target" == "$src" ]]; then
      info "Unchanged: $label"
      unchanged=$((unchanged + 1))
      return
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
      info "[DRY RUN] Would relink $dest -> $src"
    else
      rm "$dest"
      ln -s "$src" "$dest"
      success "Relinked: $label"
    fi
    updated=$((updated + 1))
    return
  fi

  if [[ -e "$dest" ]]; then
    warn "Skipping $label because $dest exists and is not a symlink"
    conflicts=$((conflicts + 1))
    return
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would link $dest -> $src"
  else
    ln -s "$src" "$dest"
    success "Linked: $label"
  fi
  created=$((created + 1))
}

remove_stale_links() {
  local source_dir="$1"
  local dest_dir="$2"
  local label_prefix="$3"

  for dest in "$dest_dir"/*; do
    [[ -L "$dest" ]] || continue

    local target
    target="$(readlink "$dest")"

    case "$target" in
      "$source_dir"/*)
        if [[ ! -e "$target" ]]; then
          if [[ "$DRY_RUN" == "true" ]]; then
            info "[DRY RUN] Would remove stale managed link: $dest"
          else
            rm "$dest"
            success "Removed stale ${label_prefix}: $(basename "$dest")"
          fi
          removed=$((removed + 1))
        fi
        ;;
    esac
  done
}

sync_skills() {
  local names=()
  local src

  for src in "$SKILLS_SOURCE_DIR"/*; do
    [[ -d "$src" ]] || continue
    names+=("$(basename "$src")")
  done

  if [[ ${#names[@]} -eq 0 ]]; then
    warn "No skill directories found under $SKILLS_SOURCE_DIR"
  fi

  for name in $(printf '%s\n' "${names[@]}" | sort); do
    link_item "$SKILLS_SOURCE_DIR/$name" "$SKILLS_DEST_DIR/$name" "skill: $name"
  done

  remove_stale_links "$SKILLS_SOURCE_DIR" "$SKILLS_DEST_DIR" "skill link"
}

sync_agents() {
  local names=()
  local src

  for src in "$AGENTS_SOURCE_DIR"/*.toml; do
    [[ -f "$src" ]] || continue
    names+=("$(basename "$src")")
  done

  if [[ ${#names[@]} -eq 0 ]]; then
    warn "No agent TOML files found under $AGENTS_SOURCE_DIR"
  fi

  for name in $(printf '%s\n' "${names[@]}" | sort); do
    link_item "$AGENTS_SOURCE_DIR/$name" "$AGENTS_DEST_DIR/$name" "agent: $name"
  done

  remove_stale_links "$AGENTS_SOURCE_DIR" "$AGENTS_DEST_DIR" "agent link"
}

ensure_dir "$SKILLS_DEST_DIR"
ensure_dir "$AGENTS_DEST_DIR"

sync_skills
sync_agents

echo ""
info "Summary:"
printf '  created:   %d\n' "$created"
printf '  updated:   %d\n' "$updated"
printf '  unchanged: %d\n' "$unchanged"
printf '  removed:   %d\n' "$removed"
printf '  conflicts: %d\n' "$conflicts"

if [[ "$conflicts" -gt 0 ]]; then
  exit 1
fi
