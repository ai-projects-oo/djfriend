# CLAUDE.md

## Architecture

DJFriend is an Electron desktop app (+ Render web service) for generating DJ sets.

**Stack:** Electron · React 19 · TypeScript · Vite · Tailwind CSS 4 · Node.js HTTP server

### Directory ownership
| Directory | Owner agent | What it contains |
|---|---|---|
| `src/` | developer-core | Audio analysis, Spotify API, scanner, settings, AI enrichment, standalone web server |
| `app/` | developer-ui | React frontend — components, hooks, lib (pure logic), types |
| `electron/` | developer-infra | Electron main process + IPC handlers |
| `test/` | qa-engineer | Vitest unit + integration tests |
| `docs/` | — | GitHub Pages marketing site |
| `.claude/agents/` | — | Custom agent definitions (use these, not built-in agents) |

### Key files
- `src/api.ts` — all HTTP API endpoints (`setupMiddlewares`)
- `src/analyzer.ts` — audio decoding + BPM/key/energy analysis
- `src/settings.ts` — reads from env vars first, then `settings.json`
- `src/standalone-server.ts` — entry point for Render web deployment
- `electron/main.ts` — Electron main process, starts the HTTP server
- `app/App.tsx` — root React component, all state wiring
- `app/lib/setGenerator.ts` — core set generation algorithm
- `app/types/index.ts` — shared TypeScript interfaces (update first)

### Build commands
```bash
npm run build              # TypeScript check + Vite frontend build → dist/
npm run build:electron     # esbuild → electron-compiled/main.js
npm run build:server       # esbuild → server-compiled/standalone-server.js
npm run electron:dev       # build + run Electron desktop app
npm start                  # start web server (Render / local web)
npm test                   # Vitest test suite
npm run lint               # ESLint
```

### Non-negotiables (flag violations as blockers)
1. `decodeAudioData` called exactly once per file in `src/analyzer.ts`
2. All Spotify API calls go through the 200ms rate-limiter in `src/api.ts`
3. `results.json` keys are additive only — never rename or remove existing keys
4. Energy neighbourhood pre-filter preserved in `app/lib/setGenerator.ts`: `top K = max(5, ceil(15% of pool))`
5. All functions in `app/lib/` must be pure — no side effects, no IPC, no localStorage
6. `app/types/index.ts` updated before any file depends on new fields

---

## Sprint Workflow (MANDATORY — follow every time)

### Starting a sprint
```bash
git checkout main && git checkout -b sprint_XX
```

### During development — USE PARALLEL AGENTS
- Use **custom project agents** from `.claude/agents/` — NOT generic built-in agents:
  - `developer-core` → `src/`
  - `developer-ui` → `app/components/`, `app/hooks/`, `app/lib/`, `app/types/`
  - `developer-infra` → `electron/`, `render.yaml`, `package.json`, build scripts
- **ALWAYS** launch independent tasks as parallel agents with `isolation: "worktree"`
- Multiple features → multiple parallel agents, NOT one-by-one
- After pulling files from a worktree agent, immediately clean up:
  ```bash
  rm -rf .claude/worktrees/agent-XXXX && git worktree prune && git branch -D worktree-agent-XXXX
  ```

### Before merging to main (ALL steps required, in order)
0. **Commit all uncommitted changes** — `git add -A && git status`, commit if anything staged
1. **`npm run build`** — 0 TypeScript errors
2. **`npm run lint`** — 0 new lint errors
3. **Write tests** — for all new business logic, state, edge cases
4. **`npm test`** — all tests must pass
5. **Launch ONE combined review agent** (using `code-reviewer` from `.claude/agents/`) that checks: code quality, edge cases, null safety, error handling, non-negotiables
6. **Fix ALL issues** found by review agent — on the sprint branch, not after merge
7. **Re-run tests** — confirm fixes didn't break anything
8. **Commit everything** on sprint branch as "Sprint X validation fixes"
9. **Tell user:** run `npm run electron:dev` in another terminal to test the desktop build
10. **Ask user: "Ready to merge?"** — wait for approval before merging
11. **Merge** — `git checkout main && git merge sprint_XX --no-ff && git push`

**NEVER:** merge with known issues, fix on main after merge, skip tests, skip review agent, commit directly to main, merge without user approval, work sequentially when parallelism is possible.

Do NOT skip any step. Do NOT ask the user to remind you. Execute all steps automatically.
