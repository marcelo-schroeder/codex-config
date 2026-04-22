---
name: my-integrate-worktree
description: Integrate the current source ref into its tracked upstream target by validating git worktree state, rebasing onto the target branch, and running the bundled integration helper. Use when a Codex worktree or main checkout branch is ready to merge into its upstream target, including detached Codex worktrees whose source branch can be inferred unambiguously.
---

Integrate the current source ref into its tracked upstream target branch from a standard git checkout or git worktree session.

Use the resolved context branch's upstream as the authoritative integration target. In `vidproj`, this usually resolves to `origin/develop`.

Run all steps without confirmation unless an error occurs.

## Authorization

Explicit user invocation of this skill authorizes the fetch, rebase, staging, commit, and bundled integration-script operations required by this workflow.

Do not perform unrelated git operations outside this workflow.

## Step 1: Resolve the Current Git Context

1. Run `git rev-parse HEAD` and store it as the initial `<source-ref>`.
2. Run `git rev-parse --short HEAD` and store it for detached-HEAD reporting.
3. Run `git rev-parse --show-toplevel` to get the current checkout path.
4. Run `git rev-parse --git-common-dir` and derive the shared repo root from it.
5. Detect whether `HEAD` is attached or detached with `git symbolic-ref --quiet --short HEAD`.

If `git symbolic-ref --quiet --short HEAD` succeeds:

- set `<context-branch>` to that branch name
- set `<source-label>` to the branch name
- resolve the upstream with `git rev-parse --abbrev-ref <context-branch>@{upstream}`

If `HEAD` is detached:

- set `<source-label>` to `detached HEAD <shortsha>`
- try to infer `<context-branch>` from local branches only (`refs/heads`)
- first, run `git for-each-ref --format='%(refname:short)' --points-at HEAD refs/heads`
- if that returns exactly one branch, use it as `<context-branch>`
- otherwise, find ancestor candidates by checking each local branch with `git merge-base --is-ancestor <branch> HEAD`
- for each ancestor candidate, compute `git rev-list --count <branch>..HEAD`
- choose the branch only if exactly one candidate has the smallest count
- if multiple branches tie for the best candidate, stop and report that detached `HEAD` cannot be mapped to a unique branch/upstream
- if no ancestor branch exists, stop and report that detached `HEAD` has no inferable local branch context
- once `<context-branch>` is inferred, resolve the upstream with `git rev-parse --abbrev-ref <context-branch>@{upstream}`

Split the upstream value into:

- `<target-remote>`
- `<target-branch>`
- `<target-ref>` = `<target-remote>/<target-branch>`

If `<context-branch>` has no upstream, stop and report that this workflow requires an upstream tracking branch.

If the current checkout path is different from the shared repo root, run `git worktree list --porcelain` and verify that the current checkout path is a registered worktree.

Do not derive branch context from the worktree name. Never use `HEAD@{upstream}` in detached mode.

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
git log <target-ref>..<source-ref> --oneline
```

If there are no commits ahead of `<target-ref>`, report `Nothing to integrate — no commits ahead of <target-ref>.` and stop.

Show this summary:

```text
Source:      <source-label>
Source ref:  <source-ref>
Context:     <context-branch>
Checkout:    <checkout-path>
Repo:        <shared-repo-root>
Target:      <target-ref>
Commits:     <N> ahead of <target-ref>
```

## Step 5: Rebase Onto the Latest Target

Run automatically:

```bash
git fetch <target-remote> <target-branch>
git rebase <target-ref>
```

This rebases the current checkout directly. In detached mode, the rebased commits remain on detached `HEAD`.

If the rebase fails:

1. run `git rebase --abort`
2. report which files conflicted
3. remind the user that the source ref has been restored to its pre-rebase state
4. stop

Do not automatically resolve rebase conflicts.

After a successful rebase:

1. recompute `<source-ref>` with `git rev-parse HEAD`
2. recompute the integrated commit list with `git log <target-ref>..<source-ref> --oneline`
3. use the refreshed commit list for all later reporting so the SHAs match the rebased commits that will be integrated

## Step 6: Run the Bundled Integration Helper

Run the bundled helper with the rebased source ref and resolved target metadata:

```bash
<skill-dir>/scripts/integrate_worktree.sh --repo-root <shared-repo-root> --source-ref <source-ref> --target-remote <target-remote> --target-branch <target-branch>
```

If the user asked to skip pushing, append `--skip-push`.

If the helper exits non-zero:

1. report the error output
2. if attached, remind the user that the rebased commits are still on `<context-branch>`
3. if detached, remind the user that the rebased commits are still checked out on detached `HEAD` and are not backed by a named branch
4. stop

## Step 7: Report Success

Show:

- the refreshed list of integrated commits after the rebase
- the repo path
- the source label
- the context branch used to resolve the upstream
- the tracked target branch
- if attached, that the current branch remains available after integration
- if detached, that the integrated commits remain checked out in the current worktree and suggest creating a branch if the user wants a durable ref
- `<target-branch> is up to date on <target-remote>.`

## Rules

- this workflow may use `git fetch`, `git rebase`, `git add`, `git reset HEAD`, `git commit`, and the bundled `integrate_worktree.sh` helper only as required by the steps above
- only pause for user input when an error occurs
- do not use `--force` on any git command
- do not use interactive git flags such as `-i` or `-p`
- prefer absolute paths when invoking the bundled helper
