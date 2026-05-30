#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<USAGE
Resolve the integration target for the current checkout without mutating git state.

Usage:
  $(basename "$0") --checkout-path <path>

Output:
  Shell-safe KEY=value lines suitable for eval/source by the caller.
USAGE
}

quote_value() {
  local value="${1-}"
  printf '%q' "$value"
}

emit() {
  local key="$1"
  local value="${2-}"
  printf '%s=%s\n' "$key" "$(quote_value "$value")"
}

short_sha() {
  git -C "$CHECKOUT_PATH" rev-parse --short "$1"
}

split_upstream() {
  local upstream="$1"
  [[ "$upstream" == */* ]] || fail "Upstream '$upstream' is not remote-qualified"
  TARGET_REMOTE="${upstream%%/*}"
  TARGET_BRANCH="${upstream#*/}"
  TARGET_REF="$upstream"
}

resolve_shared_repo_root() {
  local common_dir_raw common_dir
  common_dir_raw=$(git -C "$CHECKOUT_PATH" rev-parse --git-common-dir)
  if [[ "$common_dir_raw" == /* ]]; then
    common_dir="$common_dir_raw"
  else
    common_dir=$(cd "$CHECKOUT_PATH" && cd "$common_dir_raw" && pwd -P)
  fi

  if [[ "$(basename "$common_dir")" == ".git" ]]; then
    SHARED_REPO_ROOT=$(dirname "$common_dir")
  else
    SHARED_REPO_ROOT=$(git -C "$CHECKOUT_PATH" rev-parse --show-toplevel)
  fi
}

verify_registered_worktree() {
  if [[ "$CHECKOUT_PATH" == "$SHARED_REPO_ROOT" ]]; then
    return 0
  fi

  git -C "$CHECKOUT_PATH" worktree list --porcelain |
    awk -v target="$CHECKOUT_PATH" '
      /^worktree / {
        path = substr($0, 10)
        if (path == target) {
          found = 1
        }
      }
      END { exit(found ? 0 : 1) }
    ' ||
    fail "Checkout path is not a registered worktree: $CHECKOUT_PATH"
}

candidate_rows() {
  git -C "$CHECKOUT_PATH" for-each-ref \
    '--format=%(refname:short)%09%(upstream:short)' \
    refs/heads
}

print_candidate_diagnostics() {
  local title="$1"
  shift

  printf '%s\n' "$title" >&2
  if [[ "$#" -eq 0 ]]; then
    printf '  (no upstream-bearing local branch candidates)\n' >&2
    return 0
  fi

  local row branch upstream method source_distance target_distance fork_point fork_display note
  for row in "$@"; do
    IFS='|' read -r branch upstream method source_distance target_distance fork_point note <<<"$row"
    if [[ -n "$fork_point" && "$fork_point" != "n/a" ]]; then
      fork_display=$(git -C "$CHECKOUT_PATH" rev-parse --short "$fork_point" 2>/dev/null || printf '%s' "$fork_point")
    else
      fork_display="n/a"
    fi
    printf '  branch=%s upstream=%s method=%s source_distance=%s target_distance=%s fork_point=%s note=%s\n' \
      "$branch" "$upstream" "$method" "$source_distance" "$target_distance" "$fork_display" "$note" >&2
  done
}

record_best() {
  local row="$1"
  local source_distance="$2"

  if [[ -z "$BEST_SOURCE_DISTANCE" || "$source_distance" -lt "$BEST_SOURCE_DISTANCE" ]]; then
    BEST_SOURCE_DISTANCE="$source_distance"
    BEST_ROWS=("$row")
  elif [[ "$source_distance" -eq "$BEST_SOURCE_DISTANCE" ]]; then
    BEST_ROWS+=("$row")
  fi
}

resolve_by_fork_point() {
  local branch upstream fork_point source_distance target_distance row
  local diagnostics=()

  BEST_SOURCE_DISTANCE=""
  BEST_ROWS=()

  while IFS=$'\t' read -r branch upstream; do
    [[ -n "$upstream" ]] || continue
    if [[ -n "$CURRENT_BRANCH" && "$branch" == "$CURRENT_BRANCH" ]]; then
      continue
    fi

    if ! git -C "$CHECKOUT_PATH" rev-parse --verify --quiet "$upstream^{commit}" >/dev/null; then
      diagnostics+=("$branch|$upstream|fork-point|n/a|n/a|n/a|upstream ref does not resolve")
      continue
    fi

    fork_point=$(git -C "$CHECKOUT_PATH" merge-base --fork-point "$branch" HEAD 2>/dev/null || true)
    if [[ -z "$fork_point" ]]; then
      diagnostics+=("$branch|$upstream|fork-point|n/a|n/a|n/a|no fork point")
      continue
    fi

    if ! git -C "$CHECKOUT_PATH" merge-base --is-ancestor "$fork_point" HEAD; then
      diagnostics+=("$branch|$upstream|fork-point|n/a|n/a|$fork_point|fork point is not an ancestor of HEAD")
      continue
    fi

    source_distance=$(git -C "$CHECKOUT_PATH" rev-list --count "$fork_point..HEAD")
    target_distance=$(git -C "$CHECKOUT_PATH" rev-list --count "$fork_point..$upstream")
    row="$branch|$upstream|closest fork-point match|$source_distance|$target_distance|$fork_point|selected by fork point"
    diagnostics+=("$row")
    record_best "$row" "$source_distance"
  done < <(candidate_rows)

  if [[ "${#BEST_ROWS[@]}" -eq 1 ]]; then
    SELECTED_ROW="${BEST_ROWS[0]}"
    return 0
  fi

  if [[ "${#BEST_ROWS[@]}" -gt 1 ]]; then
    print_candidate_diagnostics "Ambiguous fork-point candidates:" "${BEST_ROWS[@]}"
    return 2
  fi

  FORK_DIAGNOSTICS=()
  if [[ "${#diagnostics[@]}" -gt 0 ]]; then
    FORK_DIAGNOSTICS=("${diagnostics[@]}")
  fi
  return 1
}

resolve_by_ancestor() {
  local branch upstream source_distance target_distance row
  local diagnostics=()

  BEST_SOURCE_DISTANCE=""
  BEST_ROWS=()

  while IFS=$'\t' read -r branch upstream; do
    [[ -n "$upstream" ]] || continue
    if [[ -n "$CURRENT_BRANCH" && "$branch" == "$CURRENT_BRANCH" ]]; then
      continue
    fi

    if ! git -C "$CHECKOUT_PATH" rev-parse --verify --quiet "$upstream^{commit}" >/dev/null; then
      diagnostics+=("$branch|$upstream|ancestor|n/a|n/a|n/a|upstream ref does not resolve")
      continue
    fi

    if ! git -C "$CHECKOUT_PATH" merge-base --is-ancestor "$branch" HEAD; then
      diagnostics+=("$branch|$upstream|ancestor|n/a|n/a|n/a|branch tip is not an ancestor of HEAD")
      continue
    fi

    source_distance=$(git -C "$CHECKOUT_PATH" rev-list --count "$branch..HEAD")
    target_distance=$(git -C "$CHECKOUT_PATH" rev-list --count "$branch..$upstream")
    row="$branch|$upstream|closest upstream-bearing ancestor|$source_distance|$target_distance|n/a|selected by ancestor"
    diagnostics+=("$row")
    record_best "$row" "$source_distance"
  done < <(candidate_rows)

  if [[ "${#BEST_ROWS[@]}" -eq 1 ]]; then
    SELECTED_ROW="${BEST_ROWS[0]}"
    return 0
  fi

  if [[ "${#BEST_ROWS[@]}" -gt 1 ]]; then
    print_candidate_diagnostics "Ambiguous ancestor candidates:" "${BEST_ROWS[@]}"
    return 2
  fi

  if [[ "${#FORK_DIAGNOSTICS[@]}" -gt 0 ]]; then
    print_candidate_diagnostics "Fork-point candidates checked:" "${FORK_DIAGNOSTICS[@]}"
  else
    print_candidate_diagnostics "Fork-point candidates checked:"
  fi

  if [[ "${#diagnostics[@]}" -gt 0 ]]; then
    print_candidate_diagnostics "Ancestor candidates checked:" "${diagnostics[@]}"
  else
    print_candidate_diagnostics "Ancestor candidates checked:"
  fi
  return 1
}

CHECKOUT_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --checkout-path)
      [[ -n "${2:-}" ]] || fail "--checkout-path requires a value"
      CHECKOUT_ARG="$2"
      shift 2
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

[[ -n "$CHECKOUT_ARG" ]] || fail "Missing required argument: --checkout-path"

CHECKOUT_PATH=$(git -C "$CHECKOUT_ARG" rev-parse --show-toplevel 2>/dev/null) ||
  fail "Checkout path is not inside a git repository: $CHECKOUT_ARG"
SOURCE_REF=$(git -C "$CHECKOUT_PATH" rev-parse HEAD)
SOURCE_SHORT=$(git -C "$CHECKOUT_PATH" rev-parse --short HEAD)
CURRENT_BRANCH=$(git -C "$CHECKOUT_PATH" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
SOURCE_LABEL=${CURRENT_BRANCH:-"detached HEAD $SOURCE_SHORT"}
FORK_POINT=""
FORK_POINT_SHORT=""
SOURCE_DISTANCE=""
TARGET_DISTANCE=""
RESOLUTION_METHOD=""
CONTEXT_BRANCH=""
TARGET_REMOTE=""
TARGET_BRANCH=""
TARGET_REF=""
SELECTED_ROW=""
BEST_SOURCE_DISTANCE=""
BEST_ROWS=()
FORK_DIAGNOSTICS=()

resolve_shared_repo_root
verify_registered_worktree

if [[ -n "$CURRENT_BRANCH" ]]; then
  direct_upstream=$(git -C "$CHECKOUT_PATH" rev-parse --abbrev-ref "$CURRENT_BRANCH@{upstream}" 2>/dev/null || true)
  if [[ -n "$direct_upstream" ]]; then
    CONTEXT_BRANCH="$CURRENT_BRANCH"
    RESOLUTION_METHOD="current branch upstream"
    split_upstream "$direct_upstream"
  fi
fi

if [[ -z "$CONTEXT_BRANCH" ]]; then
  fork_status=0
  resolve_by_fork_point || fork_status=$?
  if [[ "$fork_status" -eq 2 ]]; then
    exit 1
  fi

  if [[ -z "$SELECTED_ROW" ]]; then
    ancestor_status=0
    resolve_by_ancestor || ancestor_status=$?
    if [[ "$ancestor_status" -ne 0 ]]; then
      fail "No inferable upstream-bearing branch context from this checkout"
    fi
  fi

  IFS='|' read -r CONTEXT_BRANCH TARGET_REF RESOLUTION_METHOD SOURCE_DISTANCE TARGET_DISTANCE FORK_POINT _ <<<"$SELECTED_ROW"
  split_upstream "$TARGET_REF"
  if [[ "$FORK_POINT" != "n/a" ]]; then
    FORK_POINT_SHORT=$(short_sha "$FORK_POINT")
  else
    FORK_POINT=""
    FORK_POINT_SHORT=""
  fi
fi

emit SOURCE_REF "$SOURCE_REF"
emit SOURCE_SHORT "$SOURCE_SHORT"
emit SOURCE_LABEL "$SOURCE_LABEL"
emit CURRENT_BRANCH "$CURRENT_BRANCH"
emit CONTEXT_BRANCH "$CONTEXT_BRANCH"
emit TARGET_REMOTE "$TARGET_REMOTE"
emit TARGET_BRANCH "$TARGET_BRANCH"
emit TARGET_REF "$TARGET_REF"
emit FORK_POINT "$FORK_POINT"
emit FORK_POINT_SHORT "$FORK_POINT_SHORT"
emit SOURCE_DISTANCE "$SOURCE_DISTANCE"
emit TARGET_DISTANCE "$TARGET_DISTANCE"
emit RESOLUTION_METHOD "$RESOLUTION_METHOD"
emit CHECKOUT_PATH "$CHECKOUT_PATH"
emit SHARED_REPO_ROOT "$SHARED_REPO_ROOT"
