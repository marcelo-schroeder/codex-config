---
name: my-commit-staged
description: Commit only the currently staged changes with a single Conventional Commit message. Use when the staging area already contains exactly what should be committed.
---

# My Commit Staged

Commit only the currently staged changes.

## Authorization

Explicit user invocation of this skill authorizes `git commit` for the already staged changes only.

It does not authorize staging, unstaging, or otherwise modifying the staging area.

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
