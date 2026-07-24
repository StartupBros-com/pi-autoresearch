# Upstream relationship

- **Upstream:** https://github.com/davebcn87/pi-autoresearch
- **Divergence (as of 2026-07-24):** +16 ahead / -6 behind upstream default branch
- **Fork type:** Contribution/maintenance fork
- **Sync cadence:** Tracked by pi maintenance registry (policy fork-upstream).

## StartupBros-specific delta

Pi agent extension loaded live from dotfiles/pi/agent/settings.json. Fork customizations: package scope, typebox version, cwd-guarded auto-enter, worktree isolation.

## Why this file exists

An org-wide audit on 2026-07-24 found that comparing only the *default* branch made
several forks look like zero-delta mirrors when they actually carried unmerged
StartupBros fixes on side branches. Any future fork-pruning pass must enumerate and
author-check **all** branches, not just default-branch ahead/behind.
