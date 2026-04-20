#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

fail() {
  printf "${RED}Error: %s${NC}\n" "$*" >&2
  exit 1
}

info() {
  printf "${YELLOW}%s${NC}\n" "$*"
}

success() {
  printf "${GREEN}%s${NC}\n" "$*"
}

usage() {
  cat <<USAGE
Fast-forward a target branch with the current rebased branch.

Usage:
  $(basename "$0") --repo-root <repo-root> --branch <branch-name> --target-remote <remote> --target-branch <branch> [options]

Options:
  --repo-root <path>     Shared repository root / primary checkout path
  --branch <name>        Branch to integrate
  --target-remote <name> Remote that owns the target branch
  --target-branch <name> Target branch to fast-forward
  --dry-run              Show what would be done without executing
  --skip-push            Merge locally but do not push the target branch
  -h, --help             Show this help message

Examples:
  $(basename "$0") --repo-root /repo --branch worktree-my-feature --target-remote origin --target-branch develop
  $(basename "$0") --repo-root /repo --branch feature-branch --target-remote upstream --target-branch main --dry-run
USAGE
}

REPO_ROOT=""
BRANCH=""
TARGET_REMOTE=""
TARGET_BRANCH=""
DRY_RUN=false
SKIP_PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root)
      [[ -n "${2:-}" ]] || fail "--repo-root requires a value"
      REPO_ROOT="$2"
      shift 2
      ;;
    --branch)
      [[ -n "${2:-}" ]] || fail "--branch requires a value"
      BRANCH="$2"
      shift 2
      ;;
    --target-remote)
      [[ -n "${2:-}" ]] || fail "--target-remote requires a value"
      TARGET_REMOTE="$2"
      shift 2
      ;;
    --target-branch)
      [[ -n "${2:-}" ]] || fail "--target-branch requires a value"
      TARGET_BRANCH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-push)
      SKIP_PUSH=true
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

[[ -n "$REPO_ROOT" ]] || fail "Missing required argument: --repo-root"
[[ -n "$BRANCH" ]] || fail "Missing required argument: --branch"
[[ -n "$TARGET_REMOTE" ]] || fail "Missing required argument: --target-remote"
[[ -n "$TARGET_BRANCH" ]] || fail "Missing required argument: --target-branch"

TARGET_REF="${TARGET_REMOTE}/${TARGET_BRANCH}"

git -C "$REPO_ROOT" rev-parse --show-toplevel >/dev/null 2>&1 || fail "Resolved repo root is not a git repository: $REPO_ROOT"
git -C "$REPO_ROOT" remote get-url "$TARGET_REMOTE" >/dev/null 2>&1 || fail "Remote '$TARGET_REMOTE' does not exist in $REPO_ROOT"
git -C "$REPO_ROOT" rev-parse --verify --quiet "$BRANCH^{commit}" >/dev/null || fail "Branch '$BRANCH' does not exist in $REPO_ROOT"
git -C "$REPO_ROOT" rev-parse --verify --quiet "$TARGET_BRANCH^{commit}" >/dev/null || fail "Branch '$TARGET_BRANCH' does not exist locally in $REPO_ROOT"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}     Integrate Branch                   ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "  Repo root:       $REPO_ROOT"
echo "  Branch:          $BRANCH"
echo "  Target:          $TARGET_REF"
echo ""

ACTIONS="fast-forward ${TARGET_BRANCH} with ${BRANCH}"
[[ "$SKIP_PUSH" == "false" ]] && ACTIONS="$ACTIONS, push ${TARGET_BRANCH}"
echo "  Actions:         $ACTIONS"
[[ "$DRY_RUN" == "true" ]] && echo -e "\n  ${YELLOW}DRY RUN MODE - No changes will be made${NC}"
echo ""

info "[1/2] Merging $BRANCH into $TARGET_BRANCH (fast-forward)..."

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY RUN] Would run: git -C $REPO_ROOT checkout $TARGET_BRANCH"
  echo "[DRY RUN] Would run: git -C $REPO_ROOT pull --ff-only $TARGET_REMOTE $TARGET_BRANCH"
  echo "[DRY RUN] Would run: git -C $REPO_ROOT merge --ff-only $BRANCH"
else
  git -C "$REPO_ROOT" checkout "$TARGET_BRANCH" || {
    fail "Failed to checkout $TARGET_BRANCH. Your rebased commits are still on branch '$BRANCH'."
  }

  git -C "$REPO_ROOT" pull --ff-only "$TARGET_REMOTE" "$TARGET_BRANCH" || {
    fail "Failed to fast-forward $TARGET_BRANCH from $TARGET_REF. Your rebased commits are still on branch '$BRANCH'."
  }

  git -C "$REPO_ROOT" merge --ff-only "$BRANCH" || {
    fail "Fast-forward merge failed ($TARGET_BRANCH may have diverged). Your rebased commits are still on branch '$BRANCH'."
  }

  success "  Merged $BRANCH into $TARGET_BRANCH (fast-forward)"
fi
echo ""

if [[ "$SKIP_PUSH" == "true" ]]; then
  info "[2/2] Push skipped (--skip-push)"
else
  info "[2/2] Pushing $TARGET_BRANCH to $TARGET_REMOTE..."

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY RUN] Would run: git -C $REPO_ROOT push $TARGET_REMOTE $TARGET_BRANCH"
  else
    git -C "$REPO_ROOT" push "$TARGET_REMOTE" "$TARGET_BRANCH" || {
      fail "Failed to push $TARGET_BRANCH. The merge is done locally. Your rebased commits are still on branch '$BRANCH'."
    }

    success "  Pushed $TARGET_BRANCH to $TARGET_REMOTE"
  fi
fi
echo ""

echo -e "${BLUE}========================================${NC}"
if [[ "$DRY_RUN" == "true" ]]; then
  success "Dry run complete!"
else
  success "Integration complete!"
fi
echo -e "${BLUE}========================================${NC}"
echo ""
