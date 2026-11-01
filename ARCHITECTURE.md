# Codebase Map

A file-by-file guide to this repository: what each file does, which ones matter
most, and how the backend and frontend fit together during a single run.

Two top-level packages, deployed and run separately:

| Folder      | What it is                                      | Port   |
| ----------- | ----------------------------------------------- | ------ |
| `backend/`  | NestJS API + the agent that does all the work   | `3000` |
| `frontend/` | Vite + React single-page UI, one screen         | `5173` |

They share no code. The only contract between them is the HTTP shape of
`POST /agent-runs` and `GET /agent-runs/:runId`.

---

## The whole system in one trace

This is the part worth reading first. One run touches almost every file, in this
order:

```
Browser                         Backend                              External
───────                         ───────                              ────────
App.tsx
  submit form
  POST /agent-runs ──────────▶  agent.controller.ts
                                  validates, mints runId
                                  returns { runId } immediately
  ◀───────────────────────────    (run continues in background)
                                        │
                                        ▼
                                agent.orchestrator.ts  ── drives everything
                                        │
                                  ┌─────┼──────────────────────────┐
                                  ▼     ▼                          ▼
                          llm.service.ts  page-inspector.service.ts  prisma.service.ts
                                  │            │                       │
                                  │            └─ fetch() or Chromium ─▶ target site
                                  └─────────────── Anthropic API ──────▶ claude
                                        │
                                        ▼
                                playwright-runner.service.ts
                                  spawns `npx playwright test` ───────▶ target site
                                        │
  GET /agent-runs/:runId ─────▶  agent.controller.ts
  ◀─── status every 2s             reads AgentRun row ──────────────── Postgres
  render status + plan
```

The key structural fact: **the POST returns before the work is done.** The
controller starts the orchestrator and deliberately does not await it, so the
frontend learns everything that happens afterwards by polling `GET`. Status in
the database is the only channel between the two halves.

---

## Backend

### The important three

Start here if you are new. These hold essentially all the logic.

#### [`backend/src/agent/agent.orchestrator.ts`](backend/src/agent/agent.orchestrator.ts)

**The heart of the project.** Owns the run lifecycle end to end: creates the run
directory and the database row, then calls each service in sequence and records
a new status after each stage. Everything is wrapped in one `try/catch` that
marks the run `FAILED` with the error message and rethrows.

It writes two files per run into `backend/runs/{runId}/`: `plan.json` and
`generated.spec.ts`. A private `setStatus(runId, status, extraData?)` helper
does every database status write, so there is one place that touches
`AgentRun`. It also owns the `runsRoot` path and passes `runDir` down to the
Playwright runner, so only this file knows where run artifacts live.

#### [`backend/src/llm/llm.service.ts`](backend/src/llm/llm.service.ts)

Every Anthropic API call in the project. Three public methods:

| Method                    | Model (constant at top of file) | Returns                            |
| ------------------------- | ------------------------------- | ---------------------------------- |
| `generateTestPlan`        | `REASONING_MODEL` (Sonnet)      | `TestPlan` — feature + test cases  |
| `generatePlaywrightSpec`  | `CODEGEN_MODEL` (Haiku)         | TypeScript source as a string      |
| `analyseFailure`          | `REASONING_MODEL` (Sonnet)      | `FailureAnalysis`                  |

The two structured methods force a tool call via `tool_choice`, so the JSON
schema is the contract rather than a hope. Two private helpers remove the
duplication: `requireClient()` throws a single clear error when
`ANTHROPIC_API_KEY` is missing, and `toolInput<T>()` pulls the `tool_use` block
out of the response. If the key is absent the service constructs fine and only
throws when a method is actually called, which is why the server still boots
without a key.

> `analyseFailure` has no callers yet. See *Loose ends* below.

#### [`backend/src/page-inspector/page-inspector.service.ts`](backend/src/page-inspector/page-inspector.service.ts)

Reads the real markup of the target page so the generated tests use selectors
that actually exist instead of invented ones. Two strategies, cheapest first:

1. Plain `fetch()` and regex out `<form>`, or failing that `<input>`/`<button>`
   elements. Works for server-rendered and static pages.
2. If that yields nothing, launch headless Chromium via Playwright and read the
   DOM. Needed for client-rendered SPAs.

Output is capped at `MAX_CONTEXT_CHARS` (3000), which is the main lever on token
cost for the codegen call. The browser is closed in a `finally`, so Chromium is
gone before the LLM call runs.

### The rest of the backend

| File | What it does |
| ---- | ------------ |
| [`backend/src/agent/agent.controller.ts`](backend/src/agent/agent.controller.ts) | The only HTTP surface. `POST /agent-runs` trims and validates `prdText` + `baseUrl` (400 if either is missing), mints a `runId` with `crypto.randomUUID()`, fires the orchestrator without awaiting it, and returns the id. `GET /agent-runs/:runId` reads the row and returns a `RunStatusSnapshot`, or `UNKNOWN` if there is no such run. |
| [`backend/src/agent/agent.types.ts`](backend/src/agent/agent.types.ts) | Shared vocabulary, no logic: the `AgentStatus` enum (the run lifecycle), `TestType`, `PlannedTestCase`, `TestPlan`, and `RunStatusSnapshot` (the GET response shape). Read this file second — it defines the states everything else moves between. |
| [`backend/src/playwright/playwright-runner.service.ts`](backend/src/playwright/playwright-runner.service.ts) | Spawns `npx playwright test <spec>` as a child process in the given `runDir`, piping stdout/stderr into the Nest logger. Treats exit code 0 **and 1** as success, because 1 means "tests ran, some failed" — a valid QA outcome. Codes 2+ mean Playwright itself broke and reject. |
| [`backend/src/prisma/prisma.service.ts`](backend/src/prisma/prisma.service.ts) | Nine lines. Extends `PrismaClient` and connects on `onModuleInit` so Nest can inject the database client. |
| [`backend/src/app.module.ts`](backend/src/app.module.ts) | Wires the one controller and five providers into Nest's DI container, and loads `.env` globally. The place to register anything new. |
| [`backend/src/main.ts`](backend/src/main.ts) | Bootstrap: creates the Nest app, enables CORS (required — the frontend is on a different port), listens on `PORT` or 3000. |

### Data and schema

| File | What it does |
| ---- | ------------ |
| [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) | Two models. `AgentRun` is the run itself: `prdText`, `baseUrl`, `status`, optional `message`, and `testPlan` as JSON. `TestCase` is one planned scenario, with `onDelete: Cascade` from its run. |
| [`backend/prisma/migrations/`](backend/prisma/migrations/) | One migration, `20260527194650_init`, creating both tables and the foreign key. Applied with `pnpm prisma:migrate`. |

### Backend config

| File | What it does |
| ---- | ------------ |
| [`backend/docker-compose.yml`](backend/docker-compose.yml) | Postgres 16 for local dev. Reads credentials from `.env` and maps `${POSTGRES_PORT}` on the host to `5432` in the container. Has a `pg_isready` healthcheck. |
| [`backend/.env.example`](backend/.env.example) | Template for the real `.env`: Postgres credentials, the composed `DATABASE_URL`, `ANTHROPIC_API_KEY`, and `PORT`. |
| [`backend/package.json`](backend/package.json) | Scripts and dependencies. `start:dev` for the watch server, `prisma:migrate`, `prisma:generate`. Note `postinstall` runs `playwright install` to fetch browsers. |
| [`backend/tsconfig.json`](backend/tsconfig.json) | CommonJS, ES2018, decorators enabled (Nest needs them), emits to `dist/`. |

---

## Frontend

Three files of real content. There is no router, no state library and no CSS
framework — styles are inline objects.

| File | What it does |
| ---- | ------------ |
| [`frontend/src/App.tsx`](frontend/src/App.tsx) | **The entire UI.** A form for the requirement text and target URL, then a polling status view. On submit it POSTs, stores the returned `runId`, and a `useEffect` keyed on `runId` polls `GET /agent-runs/:runId` every 2 seconds, stopping once the status is `DONE` or `FAILED` (`TERMINAL_STATUSES`). Reads the backend URL from `VITE_API_BASE_URL`, falling back to `http://localhost:3000`. It redeclares `TestPlan`/`TestCase` locally rather than importing from the backend — the two packages are independent, so these types are duplicated by design and must be kept in sync by hand. |
| [`frontend/src/main.tsx`](frontend/src/main.tsx) | React entry point. Mounts `App` into `#root` in `StrictMode`. |
| [`frontend/src/vite-env.d.ts`](frontend/src/vite-env.d.ts) | Types `import.meta.env.VITE_API_BASE_URL` so the env read is type-safe. |
| [`frontend/index.html`](frontend/index.html) | The Vite HTML shell holding `#root`. |
| [`frontend/vite.config.ts`](frontend/vite.config.ts) | React plugin, dev server pinned to port 5173. |
| [`frontend/.env.example`](frontend/.env.example) | One variable: `VITE_API_BASE_URL`. |

---

## The run lifecycle

Set by the orchestrator, defined in `agent.types.ts`, consumed by `App.tsx`:

```
CREATED ──▶ PLANNED ──▶ INSPECTED ──▶ GENERATED ──▶ DONE
                                                  └─▶ FAILED (from any stage)
```

| Status      | Set after                        | Artifact produced                 |
| ----------- | -------------------------------- | --------------------------------- |
| `CREATED`   | the database row is inserted     | `runs/{runId}/` directory         |
| `PLANNED`   | `generateTestPlan`               | `plan.json`, plus `TestCase` rows |
| `INSPECTED` | `PageInspectorService.inspect`   | page markup held in memory        |
| `GENERATED` | `generatePlaywrightSpec`         | `generated.spec.ts`               |
| `DONE`      | the Playwright child process     | `playwright-report/`              |
| `FAILED`    | any thrown error                 | `message` column holds the reason |

`UNKNOWN` never reaches the database; the controller returns it when a `runId`
does not exist. `EXECUTED` and `ANALYZED` are declared but never set.

---

## Loose ends worth knowing

Things a newcomer would otherwise waste time discovering:

- **`TestCase` rows are written once and never updated.** They are created with
  status `PENDING` during the `PLANNED` stage and nothing ever revises them, so
  per-test pass/fail lives only in the generated HTML report, not the database.
- **`analyseFailure` is implemented but unwired.** Nothing calls it, which is
  also why `AgentStatus.EXECUTED` and `ANALYZED` are unused.
- **Runs are in-process, fire-and-forget promises.** No queue, no concurrency
  limit, and a backend restart orphans any run mid-flight — its row stays at
  whatever status it had reached.
- **There is no `playwright.config.ts`.** The runner invokes the CLI with an
  explicit spec path and flags instead.
- **Generated test code is executed without sandboxing**, on the same machine as
  the backend.
- **`runs/` is git-ignored** and created on demand, so it may not exist yet on a
  fresh clone.

---

## Where to make a change

| Task | File to open |
| ---- | ------------ |
| Change a prompt or swap models | `backend/src/llm/llm.service.ts` |
| Add or reorder a run stage | `backend/src/agent/agent.orchestrator.ts` |
| Add an API endpoint | `backend/src/agent/agent.controller.ts` |
| Add a lifecycle status | `backend/src/agent/agent.types.ts`, then `App.tsx` |
| Change what page markup the LLM sees | `backend/src/page-inspector/page-inspector.service.ts` |
| Change how tests are executed | `backend/src/playwright/playwright-runner.service.ts` |
| Add a database field | `backend/prisma/schema.prisma`, then run a migration |
| Change anything in the UI | `frontend/src/App.tsx` |
| Register a new service | `backend/src/app.module.ts` |
