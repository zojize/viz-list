# CLAUDE.md

## Pre-commit checklist (ALWAYS do all of these before committing)

1. `bun run typecheck` — typecheck
2. `bun run lint` — no lint errors
3. `bun run knip` — no unused deps/exports
4. `bun run test -- run` — all unit tests pass
5. `bun run build` — production build succeeds

## Post-push checklist

- Do not push until you are instructed to
- Wait for CI (`gh run list --limit 2`) and confirm both CI and e2e are green
- Do NOT tell the user CI passed without actually checking
