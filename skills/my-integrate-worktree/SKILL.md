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
2. Resolve the absolute helper paths for:
   - `resolve_integration_target.sh`, preferably with `realpath ~/.codex/skills/my-integrate-worktree/scripts/resolve_integration_target.sh`; if that installed path does not exist, resolve the current skill helper path and use that absolute path instead
   - `integrate_worktree.sh`, preferably with `realpath ~/.codex/skills/my-integrate-worktree/scripts/integrate_worktree.sh`; if that installed path does not exist, resolve the current skill helper path and use that absolute path instead
3. Spawn `committer` with `fork_context: false` and instruct it to execute the workflow below in `<checkout-path>`, passing:
   - the absolute helper path for `resolve_integration_target.sh`
   - the absolute helper path for `integrate_worktree.sh`
   - whether to append `--skip-push`
   - the authorization and rules from this skill
   - the complete workflow below, including resolver execution, the authorization checkpoint, rebase-abort behavior, and final reporting requirements
   - enough operative detail that the child does not need to reload this skill or re-enter `## Execution`
4. If the subagent starts successfully, wait for it to finish and treat its result as authoritative.
5. After a successful handoff, do not perform local git operations in the parent agent.
6. If the subagent reports a blocker or error, surface that result and stop.
7. If `committer` cannot be started before any repo mutation, report that delegation could not be performed and stop.

## Step 1: Resolve the Current Git Context

If `<resolver-helper>` is missing, report the missing path and stop.

Run the resolver helper exactly once before any mutating git operation:

```bash
if ! resolver_output=$(bash <resolver-helper> --checkout-path <checkout-path> 2>&1); then
  # Report resolver_output and stop.
fi
```

If the resolver succeeds, evaluate its shell-safe `KEY=value` output in the current shell:

```bash
eval "$resolver_output"
```

Use the emitted variables for the rest of the workflow:

- `SOURCE_REF`
- `SOURCE_SHORT`
- `SOURCE_LABEL`
- `CURRENT_BRANCH`
- `CONTEXT_BRANCH`
- `TARGET_REMOTE`
- `TARGET_BRANCH`
- `TARGET_REF`
- `FORK_POINT`
- `FORK_POINT_SHORT`
- `SOURCE_DISTANCE`
- `TARGET_DISTANCE`
- `RESOLUTION_METHOD`
- `CHECKOUT_PATH`
- `SHARED_REPO_ROOT`

The resolver is the authoritative implementation of scratch-branch and detached-`HEAD` target inference. Do not manually reimplement fallback branch selection in the subagent.

## Step 2: Report Resolution and Request Authorization

Before any mutating git operation, report:

When `FORK_POINT_SHORT`, `SOURCE_DISTANCE`, or `TARGET_DISTANCE` is empty, display it as `n/a`.

```text
Resolved integration target:

Source:       $SOURCE_LABEL
Source ref:   $SOURCE_REF
Context:      $CONTEXT_BRANCH
Fork point:   $FORK_POINT_SHORT
Target:       $TARGET_REF
Reason:       $RESOLUTION_METHOD; source is $SOURCE_DISTANCE commit(s) after the fork/context point; target ref is $TARGET_DISTANCE commit(s) after that point in local refs

Continue with cleanliness handling, fetch, rebase, fast-forward integration, and push?
```

If `--skip-push` will be passed to the helper, replace `and push` in the authorization question with `with push skipped`.

Then pause for explicit user authorization.

If the user does not authorize continuation, stop without running fetch, staging, commit, rebase, the bundled helper, or push.

## Step 3: Verify the Bundled Integration Helper

Require the passed integration helper path to exist:

```text
<integration-helper>
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
git fetch "$TARGET_REMOTE" "$TARGET_BRANCH"
git log "$TARGET_REF..$SOURCE_REF" --oneline
```

If there are no commits ahead of `$TARGET_REF`, report `Nothing to integrate — no commits ahead of $TARGET_REF.` and stop.

Show this summary:

```text
Source:      $SOURCE_LABEL
Source ref:  $SOURCE_REF
Context:     $CONTEXT_BRANCH
Method:      $RESOLUTION_METHOD
Checkout:    $CHECKOUT_PATH
Repo:        $SHARED_REPO_ROOT
Target:      $TARGET_REF
Commits:     <N> ahead of $TARGET_REF
```

## Step 6: Rebase Onto the Latest Target

Run automatically:

```bash
git fetch "$TARGET_REMOTE" "$TARGET_BRANCH"
git rebase "$TARGET_REF"
```

This rebases the current checkout directly. If on a scratch branch, the rebased commits remain on that scratch branch. In detached mode, the rebased commits remain on detached `HEAD`.

If the rebase fails:

1. run `git rebase --abort`
2. report which files conflicted
3. remind the user that the source ref has been restored to its pre-rebase state
4. stop

Do not automatically resolve rebase conflicts.

After a successful rebase:

1. recompute `SOURCE_REF` with `git rev-parse HEAD`
2. recompute the integrated commit list with `git log "$TARGET_REF..$SOURCE_REF" --oneline`
3. use the refreshed commit list for all later reporting so the SHAs match the rebased commits that will be integrated

## Step 7: Run the Bundled Integration Helper

Run the bundled helper with the rebased source ref and resolved target metadata:

```bash
bash <integration-helper> --repo-root "$SHARED_REPO_ROOT" --source-ref "$SOURCE_REF" --target-remote "$TARGET_REMOTE" --target-branch "$TARGET_BRANCH"
```

If the user asked to skip pushing, append `--skip-push`.

If the helper exits non-zero:

1. report the error output
2. if `CURRENT_BRANCH` is non-empty, remind the user that the rebased commits are still on `$SOURCE_LABEL`
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
- `$TARGET_BRANCH is up to date on $TARGET_REMOTE.`

## Rules

- this workflow may use `git fetch`, `git rebase`, `git add`, `git reset HEAD`, `git commit`, and the bundled `integrate_worktree.sh` helper only as required by the steps above
- pause for user authorization after target resolution, and otherwise only pause for user input when an error occurs
- do not use `--force` on any git command
- do not use interactive git flags such as `-i` or `-p`
- prefer absolute paths when invoking the bundled helper
