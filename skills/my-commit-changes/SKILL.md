---
name: my-commit-changes
description: Commit all uncommitted changes, grouping related files into atomic Conventional Commits. Use when staged, unstaged, or untracked changes should be committed together.
---

# My Commit Changes

Commit all uncommitted changes, intelligently grouping related files into one or more atomic Conventional Commits.

This workflow works the same from an attached branch or detached `HEAD`; it does not require branch or upstream resolution.

## Authorization

Explicit user invocation of this skill authorizes the git inspection, staging, unstaging, and commit operations required by this workflow.

Do not perform unrelated git operations outside this workflow.

## Preferred Execution

Before any repo mutation, prefer delegating the full workflow to `committer`.

1. Resolve `<repo-root>` with `git rev-parse --show-toplevel`.
2. Try `spawn_agent` with:
   - `agent_type: "committer"`
   - `fork_context: false`
   - a narrow task prompt that includes:
     - `<repo-root>`
     - the user's request nuance, including whether they explicitly asked to stop after the plan
     - the authorization and rules from this skill
     - the complete fallback workflow below
     - the expected final outputs: either `No uncommitted changes found.`, a numbered commit plan, or the commit messages used
     - enough operative detail that the child does not need to reload this skill on its own
3. If the subagent starts successfully, wait for it to finish and treat its result as authoritative.
4. After a successful handoff, do not perform local git operations in the parent agent.
5. If the subagent reports a blocker or error after it started, surface that result and stop.
6. Only if the subagent cannot be started before any repo mutation, run the fallback workflow below in the current agent.

## Fallback Step 1: Gather All Changes

Run these commands to understand the full picture:

- `git status --porcelain` to list changed and untracked files
- `git diff HEAD` to inspect tracked-file changes across staged and unstaged content
- read any untracked files so you understand what they contain before committing them

If there are no changes at all, report `No uncommitted changes found.` and stop.

## Fallback Step 2: Analyze and Group Changes

Treat all changes as a single pool regardless of current staging state. Group files into logical commits based on:

- related functionality
- same component or feature area
- same type of change

If everything belongs together, use a single commit. Do not split unnecessarily.

## Fallback Step 3: Present the Commit Plan

Show a numbered list of proposed commits, each with:

- the Conventional Commit message
- the files included in that commit

If the user explicitly asked to stop after the plan, stop here. Otherwise continue directly to execution.

## Fallback Step 4: Execute the Commits

When practical, use a single non-interactive shell call that chains the required `git add` and `git commit` operations.

Example pattern:

```bash
git reset HEAD && \
git add file1 file2 && git commit -m "feat(scope): subject" && \
git add file3 && git commit -m "fix(scope): subject" && \
git status
```

After the command completes, report the commit messages used.

## Rules

- This workflow may use `git add`, `git reset HEAD`, and `git commit` only as required by the steps above
- do not push to a remote
- do not use `git add -A` or `git add .`; always add specific files by name
- do not use interactive git flags such as `-i` or `-p`
- commit messages must use Conventional Commits
- keep commit subjects at or below 72 characters and in imperative mood
