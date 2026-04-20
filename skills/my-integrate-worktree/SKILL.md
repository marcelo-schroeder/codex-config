---
name: my-integrate-worktree
description: Integrate the current branch into its tracked upstream target by validating git worktree state, rebasing onto the target branch, and running the bundled integration helper. Use when a Codex worktree or main checkout branch is ready to merge into its upstream target, typically origin/develop in vidproj.
---

# My Integrate Worktree

Integrate the current branch into its tracked upstream target branch from a standard git checkout or git worktree session.

Use the current branch's upstream as the authoritative integration target. In `vidproj`, this usually resolves to `origin/develop`.

Run all steps without confirmation unless an error occurs.

## Authorization

Explicit user invocation of this skill authorizes the fetch, rebase, staging, commit, and bundled integration-script operations required by this workflow.

Do not perform unrelated git operations outside this workflow.

## Step 1: Resolve the Current Git Context

1. Run `git branch --show-current` and require a non-empty branch name.
2. Run `git rev-parse --show-toplevel` to get the current checkout path.
3. Run `git rev-parse --git-common-dir` and derive the shared repo root from it.
4. Run `git rev-parse --abbrev-ref @{upstream}` to resolve the tracked upstream branch.
5. Split the upstream value into:
   - `<target-remote>`
   - `<target-branch>`
   - `<target-ref>` = `<target-remote>/<target-branch>`

If the current branch has no upstream, stop and report that this workflow requires an upstream tracking branch.

If the current checkout path is different from the shared repo root, run `git worktree list --porcelain` and verify that the current checkout path is a registered worktree.

Do not derive the branch name from the worktree name. Always use `git branch --show-current`.

## Step 2: Verify the Bundled Helper

Define `<skill-dir>` as the directory containing this `SKILL.md`.

Require this helper to exist:

```text
<skill-dir>/scripts/integrate_worktree.sh
```

If it is missing, report the missing path and stop.

## Step 3: Check Cleanliness

Run `git status --porcelain`.

If the working tree is dirty:

1. Report uncommitted changes grouped as:
   - staged changes via `git diff --cached --stat`
   - unstaged tracked changes via `git diff --stat`
   - untracked files from porcelain output
2. Commit everything before continuing, following the workflow from `my-commit-changes`.

## Step 4: Fetch and Inspect Commits Ahead of the Target

Run:

```bash
git fetch <target-remote> <target-branch>
git log <target-ref>..HEAD --oneline
```

If there are no commits ahead of `<target-ref>`, report `Nothing to integrate — no commits ahead of <target-ref>.` and stop.

Show this summary:

```text
Branch:    <branch>
Checkout:  <checkout-path>
Repo:      <shared-repo-root>
Target:    <target-ref>
Commits:   <N> ahead of <target-ref>
```

## Step 5: Rebase Onto the Latest Target

Run automatically:

```bash
git fetch <target-remote> <target-branch>
git rebase <target-ref>
```

If the rebase fails:

1. run `git rebase --abort`
2. report which files conflicted
3. remind the user that the branch has been restored to its pre-rebase state
4. stop

Do not automatically resolve rebase conflicts.

## Step 6: Run the Bundled Integration Helper

Run the bundled helper with the actual branch name and resolved target metadata:

```bash
<skill-dir>/scripts/integrate_worktree.sh --repo-root <shared-repo-root> --branch <branch> --target-remote <target-remote> --target-branch <target-branch>
```

If the user asked to skip pushing, append `--skip-push`.

If the helper exits non-zero:

1. report the error output
2. remind the user that the rebased commits are still on the current branch
3. stop

## Step 7: Report Success

Show:

- the list of integrated commits from Step 4
- the repo path
- the integrated branch
- the tracked target branch
- that the current branch remains available after integration
- `<target-branch> is up to date on <target-remote>.`

## Rules

- this workflow may use `git fetch`, `git rebase`, `git add`, `git reset HEAD`, `git commit`, and the bundled `integrate_worktree.sh` helper only as required by the steps above
- only pause for user input when an error occurs
- do not use `--force` on any git command
- do not use interactive git flags such as `-i` or `-p`
- prefer absolute paths when invoking the bundled helper
