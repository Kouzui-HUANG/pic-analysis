---
name: git-push
description: >
  Stage, commit, and push all pending changes to remote in one automated step.
  Trigger when user says "push", "push到GitHub", "幫我push", "commit and push",
  or any variation implying local changes should be committed and pushed.
---

# Git Push — Automated Commit & Push

Stage all meaningful changes, generate a commit message, and push to remote.

## Procedure

1. **Inspect** (parallel):
   - `git status` — modified/untracked files
   - `git diff` + `git diff --cached` — review changes
   - `git log --oneline -5` — match existing commit style
   - `git remote -v` — confirm remote; abort if missing

2. **Stage**:
   - Add modified and untracked project files by name
   - Exclude OS artifacts (`.DS_Store`, `Thumbs.db`) and secrets (`.env`, credentials)
   - If nothing meaningful to commit, inform user and stop

3. **Commit**:
   - Imperative summary under 72 chars, classify as feature/fix/refactor/style/test/docs
   - Optional body explaining "why"
   - Append `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
   - Use HEREDOC format

4. **Push**:
   - `git push origin <current-branch>`
   - Report commit hash and push result

## Guardrails

- Never `--force` or `--no-verify`
- Never amend unless user explicitly asks
- Never stage secrets — warn if detected
- On hook failure: fix, then new commit (never amend)
