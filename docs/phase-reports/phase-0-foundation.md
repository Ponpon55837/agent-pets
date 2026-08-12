# Phase 0 — Architecture, project skill, and delivery gates

Date: 2026-08-11
Baseline version: `0.5.5`
Approved version: `0.5.6`

## Scope

Phase 0 establishes the durable instructions and validation gates that every later roadmap phase must follow. It does not change application runtime behavior.

## Delivered

- Added the complete Traditional Chinese `Desktop Pet Architecture v2 + Feature Roadmap` under `docs/architecture/`.
- Added the project-local `.agents/skills/pet-skill` using the standard skill initializer.
- Added concise project, Liquid Glass, and phase-gate references for future agents.
- Added root `AGENTS.md` so agents can find the project skill even if a client does not inject repository-local skills automatically.
- Added the Apple Liquid Glass visual contract to the architecture roadmap.
- Added the explicit workflow: implement → functional validation → security review → phase report → user confirmation → version update.
- Defined patch as the default increment and minor for large architecture, persistent-schema, public-contract, or security-boundary changes.

## Functional and structure validation

| Check | Result |
|---|---|
| `pet-skill` initialized with the official `skill-creator` script | Passed |
| Skill frontmatter contains only `name` and `description` | Passed by manual structural check |
| Skill name matches folder and contains no TODO placeholder | Passed |
| Skill and architecture references resolve | Passed |
| Skill body length | 63 lines; below the 500-line guidance |
| `agents/openai.yaml` generated with required display metadata and `$pet-skill` prompt | Passed |
| Official `quick_validate.py` | Passed after supplying temporary `PyYAML` in the system temp directory; project dependencies and lockfile were unchanged |
| Direct `vue-tsc --noEmit` | Passed |
| Vite renderer/main/preload production build | Passed |
| Automated product tests | Not available; `package.json` currently has no test script/harness |

The bundled validator environment initially lacked `PyYAML`. A temporary validator-only dependency was supplied outside the repository, the official validator then reported `Skill is valid!`, and the explicit naming, frontmatter, placeholder, line-count, and reference checks also passed.

## Security validation

| Check | Result |
|---|---|
| `pnpm audit --audit-level high` | Passed; no known vulnerabilities found |
| High-confidence credential pattern scan | Passed; no private key or known token formats found outside excluded dependency/generated/user-owned directories |
| Runtime trust-boundary changes | None |
| New runtime dependencies | None |
| New IPC, HTTP, filesystem, credential, notification, shortcut, or MCP surface | None |
| Skill safety review | Passed; preserves sandbox/IPC/event limits and explicitly rejects generic permission callbacks, command execution, and MCP authority expansion |
| User-owned `.claude/` directory | Preserved and not modified |

## Liquid Glass decision

The project adopts Apple's principles, not a claim of pixel-identical platform material:

- use glass for the functional/navigation layer only;
- keep pet, history, lists, charts, and settings content in the content layer;
- avoid glass-on-glass and nested backdrop filters;
- prefer the legible regular treatment;
- use clear treatment only over rich content with a tested dimming layer;
- provide reduced-transparency, higher-contrast, reduced-motion, and opaque fallbacks;
- validate real Electron output over light, dark, and detailed backgrounds.

## Residual risks and gaps

- The repository has no automated test script. Each feature phase must add targeted tests or record a deterministic runtime validation until a harness exists.
- Phase 0 changes documentation and agent workflow only; no real Tray, notification, DND, or Liquid Glass UI behavior was implemented or visually tested yet.
- macOS and Linux remain untested in this phase.
- `.agents` is protected by the desktop sandbox in this session; writing the project-local skill required a narrowly scoped approved copy into that directory.

## Version recommendation

Approved and applied: patch `0.5.5 → 0.5.6`.

Reason: this phase adds project documentation and agent delivery controls without changing application behavior, public runtime contracts, persistence, or a security boundary.

The user confirmed Phase 0 on 2026-08-11. The package version was updated without creating a tag or publishing a release. `pnpm-lock.yaml` does not encode the root package version, so no lockfile content change was required.
