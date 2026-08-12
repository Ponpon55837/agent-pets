# Phase validation, security, and version gates

## Before implementation

- Record `git status --short`, current branch/commit, and `package.json` version.
- Read the active phase in the architecture roadmap and convert it to explicit acceptance criteria.
- Identify current user changes and files that must remain untouched.
- List changed trust boundaries: renderer, preload/IPC, local HTTP, filesystem, credentials, hooks, native notifications, global shortcuts, or MCP.

## Functional gate

- Run `pnpm.cmd exec vue-tsc --noEmit`.
- Run `pnpm.cmd exec vite build` for normal source changes.
- Run `pnpm.cmd build` before a release candidate or when packaging/native behavior changes.
- Add targeted automated tests when a test harness exists; if it does not, record the gap and add deterministic fixture or runtime checks appropriate to the phase.
- Validate the real requested surface: Electron window, Tray, notification, hook delivery, MCP call, packaged hook, or database migration.

## Security gate

- Run dependency audit at the lockfile level and record unavailable network checks honestly.
- Run a repository secret scan that excludes generated/dependency directories and distinguishes public OAuth client IDs from credentials.
- Review every new IPC channel for sender validation, runtime payload validation, bounded values, and least privilege.
- Review local servers for loopback-only binding, authentication, body/rate limits, method allowlists, and safe shutdown.
- Review filesystem operations for canonical paths, traversal, symlinks/reparse points, size limits, atomic writes, and permissions.
- Review notifications and UI text for prompt, path, token, tool-argument, and secret disclosure.
- For Permission Broker work, test spoofing, replay, expiry, concurrent decisions, restart, external resolution, and renderer compromise assumptions.
- For MCP work, prove the tools cannot execute commands, access files, decide permissions, or mutate progression truth.

## Visual and accessibility gate

- Follow `liquid-glass.md` and compare light/dark/high-detail backdrops.
- Check glass hierarchy, no nested glass, focus visibility, contrast, reduced motion, and opaque fallback.
- Verify transparent-region click-through and interactive-region hit testing when affected.
- Verify multi-monitor and DPI behavior when window geometry changes.

## Diff and regression gate

- Run `git diff --check`.
- Review `git diff --stat`, `git diff --name-only`, and the complete relevant diff.
- Confirm no formatter-induced unrelated edits, generated artifacts, credentials, or user-owned files were added.
- Update both READMEs and architecture/skill references when contracts or user behavior change.
- Write `docs/phase-reports/phase-N-<slug>.md` with scope, evidence, security result, residual risk, and version recommendation.

## Confirmation and version gate

1. Finish all gates and present the phase report without changing the version.
2. Wait for explicit user confirmation.
3. After approval, select the increment:
   - Patch: contained additive feature, UI refinement, adapter fix, or documentation/process phase without a breaking public contract.
   - Minor: substantial new subsystem, persistent schema/migration, public adapter/MCP contract, control-plane/security-boundary change, or broad behavior-engine refactor.
4. Update `package.json` and `pnpm-lock.yaml` together; do not create `package-lock.json`.
5. Re-run type-check, build, diff, and relevant security checks after the version update.
6. Do not tag, publish, or create a release unless explicitly requested.

Suggested roadmap classification, subject to the actual diff and user confirmation:

| Stage | Default recommendation |
|---|---|
| Phase 0 skill/docs/process baseline | Patch |
| Phase 1 Tray/Notification/DND | Patch |
| Phase 2 Permission Broker | Minor |
| Phase 3 XP/persistent progression | Minor |
| Phase 4 Mini/Edge | Patch |
| Phase 5 Agent Adapter SDK | Minor |
| Phase 6 Presentation MCP | Minor |
| Phase 7 History/HUD | Patch or Minor if it introduces the first durable event schema |
| Phase 8 Per-project Pet | Patch |
| Phase 9 Achievements | Patch |
| Phase 10 Shimeji engine | Minor |
