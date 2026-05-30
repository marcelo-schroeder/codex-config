---
name: my-integrate-worktree
description: Integrate the current source ref into its resolved upstream target by validating git worktree state, rebasing onto the target branch, and running the bundled integration helper. Use when a Codex worktree or main checkout branch is ready to merge into its upstream target, including scratch branches and detached Codex worktrees whose source branch can be inferred unambiguously.
---

Integrate the current source ref into its resolved upstream target branch from a standard git checkout or git worktree session.

Use the resolved context branch's upstream as the authoritative integration target. In `vidproj`, this usually resolves to `origin/develop`.

Resolve and report the integration target first, then pause for explicit user authorization before any mutating git operation.

## Authorization

Explicit user invocation of this skill authorizes non-mutating inspection and target resolution.

After resolving the target, the delegated subagent must report the resolved source, context, target, and selection reason, then ask for explicit user authorization before running any command that may mutate repository state. User authorization to continue authorizes the fetch, rebase, staging, commit, and bundled integration-script operations required by this workflow for the reported source and target.

Do not perform unrelated git operations outside this workflow.

## Execution

Before any repo mutation, delegate the full workflow to `committer`.

1. Resolve `<checkout-path>` with `git rev-parse --show-toplevel`.
2. Resolve the absolute helper path for `integrate_worktree.sh`, preferably with `realpath ~/.codex/skills/my-integrate-worktree/scripts/integrate_worktree.sh`; if that installed path does not exist, resolve the current skill helper path and use that absolute path instead.
3. Spawn `committer` with `fork_context: false` and instruct it to execute the workflow below in `<checkout-path>`, passing:
   - the absolute helper path for `integrate_worktree.sh`
   - whether to append `--skip-push`
   - the authorization and rules from this skill
   - the complete workflow below, including scratch-branch and detached-`HEAD` inference, the authorization checkpoint, upstream resolution, rebase-abort behavior, and final reporting requirements
   - enough operative detail that the child does not need to reload this skill or re-enter `## Execution`
4. If the subagent starts successfully, wait for it to finish and treat its result as authoritative.
5. After a successful handoff, do not perform local git operations in the parent agent.
6. If the subagent reports a blocker or error, surface that result and stop.
7. If `committer` cannot be started before any repo mutation, report that delegation could not be performed and stop.

## Step 1: Resolve the Current Git Context

1. Run `git rev-parse HEAD` and store it as the initial `<source-ref>`.
2. Run `git rev-parse --short HEAD` and store it for detached-HEAD reporting.
3. Run `git rev-parse --show-toplevel` to get the current checkout path.
4. Run `git rev-parse --git-common-dir` and derive the shared repo root from it.
5. Detect whether `HEAD` is attached or detached with `git symbolic-ref --quiet --short HEAD`.

If `git symbolic-ref --quiet --short HEAD` succeeds:

- set `<current-branch>` to that branch name
- set `<source-label>` to that branch name
- try to resolve the upstream with `git rev-parse --abbrev-ref <current-branch>@{upstream}`
- if the upstream resolves, set `<context-branch>` to `<current-branch>`, set `<fork-point>` to empty, set `<source-distance>` and `<target-distance>` to empty, set `<resolution-method>` to `current branch upstream`, and use that upstream as the authoritative target
- if the upstream does not resolve, treat `<current-branch>` as a scratch branch and infer `<context-branch>` using the fallback resolver below, excluding `<current-branch>` from candidates

If `HEAD` is detached:

- set `<current-branch>` to empty
- set `<source-label>` to `detached HEAD <shortsha>`
- infer `<context-branch>` using the fallback resolver below

### Fallback Resolver for Scratch Branches and Detached `HEAD`

Use this resolver only when the current checkout cannot provide its own upstream.

1. List local branch candidates with `git for-each-ref --format='%(refname:short)%09%(upstream:short)' refs/heads`.
2. Keep only candidates where:
   - the branch is not `<current-branch>`, if `<current-branch>` is set
   - the branch has a non-empty upstream
3. First try fork-point resolution:
   - for each candidate, run `git merge-base --fork-point <candidate> HEAD`
   - keep candidates where the fork point resolves and is an ancestor of `HEAD`
   - compute `<source-distance>` with `git rev-list --count <fork-point>..HEAD`
   - compute `<target-distance>` with `git rev-list --count <fork-point>..<candidate-upstream>`
   - select the candidate only if exactly one candidate has the smallest `<source-distance>`
   - set `<context-branch>` to that candidate, `<fork-point>` to the resolved fork-point SHA, and `<resolution-method>` to `closest fork-point match`
4. If no fork-point candidates resolve, fall back to ancestor resolution:
   - keep candidates where `git merge-base --is-ancestor <candidate> HEAD` succeeds
   - compute `<source-distance>` with `git rev-list --count <candidate>..HEAD`
   - compute `<target-distance>` with `git rev-list --count <candidate>..<candidate-upstream>`
   - select the candidate only if exactly one candidate has the smallest `<source-distance>`
   - set `<context-branch>` to that candidate, `<fork-point>` to empty, and `<resolution-method>` to `closest upstream-bearing ancestor`
5. If no candidates resolve, stop and report that the checkout has no inferable upstream-bearing branch context.
6. If multiple candidates tie for the best candidate, stop and report all tied branches and their upstreams so the user can choose or configure a branch upstream.
7. Once `<context-branch>` is selected, resolve the upstream with `git rev-parse --abbrev-ref <context-branch>@{upstream}`.

Split the resolved upstream value into:

- `<target-remote>`
- `<target-branch>`
- `<target-ref>` = `<target-remote>/<target-branch>`

If `<context-branch>` has no upstream, stop and report that this workflow requires an upstream-bearing context branch.

If the current checkout path is different from the shared repo root, run `git worktree list --porcelain` and verify that the current checkout path is a registered worktree.

Do not derive branch context from the worktree name. Never use `HEAD@{upstream}` in detached mode or when the current branch has no upstream.

## Step 2: Report Resolution and Request Authorization

Before any mutating git operation, report:

```text
Resolved integration target:

Source:       <source-label>
Source ref:   <source-ref>
Context:      <context-branch>
Fork point:   <fork-point or n/a>
Target:       <target-ref>
Reason:       <resolution-method>; source is <source-distance or n/a> commit(s) after the fork/context point, target ref is <target-distance or n/a> commit(s) after that point in local refs

Continue with cleanliness handling, fetch, rebase, fast-forward integration, and push?
```

If `--skip-push` will be passed to the helper, replace `and push` in the authorization question with `with push skipped`.

Then pause for explicit user authorization.

If the user does not authorize continuation, stop without running fetch, staging, commit, rebase, the bundled helper, or push.

## Step 3: Verify the Bundled Helper

Define `<skill-dir>` as the directory containing this `SKILL.md`.

Require this helper to exist:

```text
<skill-dir>/scripts/integrate_worktree.sh
```

If it is missing, report the missing path and stop.

## Step 4: Check Cleanliness

Run `git status --porcelain`.

If the working tree is dirty:

1. Report uncommitted changes grouped as:
   - staged changes via `git diff --cached --stat`
   - unstaged tracked changes via `git diff --stat`
   - untracked files from porcelain output
2. Commit everything before continuing, following the workflow from `my-commit-changes`.

## Step 5: Fetch and Inspect Commits Ahead of the Target

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
Method:      <resolution-method>
Checkout:    <checkout-path>
Repo:        <shared-repo-root>
Target:      <target-ref>
Commits:     <N> ahead of <target-ref>
```

## Step 6: Rebase Onto the Latest Target

Run automatically:

```bash
git fetch <target-remote> <target-branch>
git rebase <target-ref>
```

This rebases the current checkout directly. If on a scratch branch, the rebased commits remain on that scratch branch. In detached mode, the rebased commits remain on detached `HEAD`.

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

## Step 7: Run the Bundled Integration Helper

Run the bundled helper with the rebased source ref and resolved target metadata:

```bash
<skill-dir>/scripts/integrate_worktree.sh --repo-root <shared-repo-root> --source-ref <source-ref> --target-remote <target-remote> --target-branch <target-branch>
```

If the user asked to skip pushing, append `--skip-push`.

If the helper exits non-zero:

1. report the error output
2. if attached, remind the user that the rebased commits are still on `<source-label>`
3. if detached, remind the user that the rebased commits are still checked out on detached `HEAD` and are not backed by a named branch
4. stop

## Step 8: Report Success

Show:

- the refreshed list of integrated commits after the rebase
- the repo path
- the source label
- the context branch used to resolve the upstream
- the resolution method
- the tracked target branch
- if attached, that the source branch remains available after integration
- if detached, that the integrated commits remain checked out in the current worktree and suggest creating a branch if the user wants a durable ref
- `<target-branch> is up to date on <target-remote>.`

## Rules

- this workflow may use `git fetch`, `git rebase`, `git add`, `git reset HEAD`, `git commit`, and the bundled `integrate_worktree.sh` helper only as required by the steps above
- pause for user authorization after target resolution, and otherwise only pause for user input when an error occurs
- do not use `--force` on any git command
- do not use interactive git flags such as `-i` or `-p`
- prefer absolute paths when invoking the bundled helper
