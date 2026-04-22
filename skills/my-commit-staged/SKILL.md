---
name: my-commit-staged
description: Commit only the currently staged changes with a single Conventional Commit message. Use when the staging area already contains exactly what should be committed.
---

Commit only the currently staged changes.

This workflow works the same from an attached branch or detached `HEAD`; it does not require branch or upstream resolution.

## Authorization

Explicit user invocation of this skill authorizes `git commit` for the already staged changes only.

It does not authorize staging, unstaging, or otherwise modifying the staging area.

## Execution

Before any repo mutation, delegate the full workflow to `committer`.

1. Resolve `<repo-root>` with `git rev-parse --show-toplevel`.
2. Spawn `committer` with `fork_context: false` and instruct it to execute the workflow below in `<repo-root>`, passing:
   - the user's request nuance
   - the staged-only authorization and rules from this skill
   - the expected final output: `No staged changes to commit.` or the final commit message used
   - the complete workflow below as operative instructions
   - enough operative detail that the child does not need to reload this skill or re-enter `## Execution`
3. If the subagent starts successfully, wait for it to finish and treat its result as authoritative.
4. After a successful handoff, do not perform local git operations in the parent agent.
5. If the subagent reports a blocker or error, surface that result and stop.
6. If `committer` cannot be started before any repo mutation, report that delegation could not be performed and stop.

## Workflow

1. Run `git diff --cached --stat` to check whether anything is staged.
2. If nothing is staged, report `No staged changes to commit.` and stop.
3. Run `git diff --cached` to inspect the staged changes.
4. Pick the best Conventional Commit type: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, or `ci`.
5. Determine a short scope from the dominant directory or component.
6. Craft a single-line subject at or below 72 characters, in imperative mood.
7. If multiple areas changed, choose the primary area for the scope.
8. Run `git commit -m "<type>(<scope>): <subject>"`.
9. Report the final commit message used.

## Rules

- do not stage or unstage any files
- do not use `git add`, `git restore --staged`, or `git reset`
- only commit what is already staged
