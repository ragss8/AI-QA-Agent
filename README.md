# Agentic AI QA Engineer

This repository contains a local proof-of-concept AI QA assistant. The project
accepts a product requirement, generates a test plan, inspects the target page,
creates Playwright test code, runs the tests locally, and exposes run status
through a NestJS backend and a Vite/React frontend.

## What It Does

- Accepts product requirements and a target base URL
- Generates a test plan with happy, negative, and edge-case scenarios
- Inspects the target page and extracts its real form markup
- Produces Playwright test code from the plan and the inspected selectors
- Runs tests locally and stores artifacts under `backend/runs/`
- Persists runs and planned test cases in PostgreSQL via Prisma
- Exposes run status through the backend API and frontend UI

## How A Run Works

A run advances through the statuses in `backend/src/agent/agent.types.ts`:

```text
CREATED -> PLANNED -> INSPECTED -> GENERATED -> DONE
```

Any failing stage moves the run to `FAILED` and records the error message.
`GET /agent-runs/:runId` returns the current status, so the frontend polls it
until the run reaches `DONE` or `FAILED`.

| Stage       | Who does it                  | Output                             |
| ----------- | ---------------------------- | ---------------------------------- |
| `PLANNED`   | `LlmService.generateTestPlan`| `runs/{runId}/plan.json`           |
| `INSPECTED` | `PageInspectorService`       | Page markup used for selectors     |
| `GENERATED` | `LlmService.generatePlaywrightSpec` | `runs/{runId}/generated.spec.ts` |
| `DONE`      | `PlaywrightRunnerService`    | `runs/{runId}/playwright-report/`  |

Page inspection tries a plain HTTP fetch first and falls back to a headless
Chromium page when the target is a client-rendered SPA. Only the first ~3000
characters of markup are sent to the model, which keeps token usage bounded.

## Repository Structure

```text
ai-qa-agent/
|-- README.md
|-- .gitignore
|-- backend/
|   |-- .env.example
|   |-- docker-compose.yml
|   |-- package.json
|   |-- prisma/
|   |   |-- schema.prisma
|   |   `-- migrations/
|   |-- runs/                     # generated at runtime, git-ignored
|   `-- src/
|       |-- main.ts
|       |-- app.module.ts
|       |-- agent/                # controller, orchestrator, shared types
|       |-- llm/                  # Anthropic calls
|       |-- page-inspector/       # extracts real selectors from the target page
|       |-- playwright/           # spawns the Playwright CLI
|       `-- prisma/
`-- frontend/
    |-- .env.example
    |-- index.html
    |-- package.json
    |-- vite.config.ts
    `-- src/
        |-- main.tsx
        `-- App.tsx
```

## Prerequisites

- Node.js 18+ (the backend uses the global `fetch` and `crypto.randomUUID`)
- pnpm
- Docker, for the local PostgreSQL instance
- An `ANTHROPIC_API_KEY`

## Environment Files

Copy each example file and fill in your own values:

```sh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

`backend/.env` supplies the PostgreSQL credentials used by both
`docker-compose.yml` and Prisma's `DATABASE_URL`, plus `ANTHROPIC_API_KEY` and
the backend `PORT`. `frontend/.env` only sets `VITE_API_BASE_URL`.

## How To Start The Project

### 1. Install Backend Dependencies

```sh
cd backend
pnpm install
sudo pnpm exec playwright install-deps
```

### 2. Start PostgreSQL

With `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT`
set in `backend/.env`, run the following from the `backend` directory and wait
for the container to report healthy:

```sh
docker compose up -d
```

### 3. Start The Backend

With `POSTGRES_HOST`, `ANTHROPIC_API_KEY`, and `PORT` also set:

```sh
pnpm prisma:migrate
pnpm run start:dev
```

Backend URL:

```text
http://localhost:3000
```

### 4. Start The Frontend

```sh
cd frontend
pnpm install
pnpm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## How To Run The Application

1. Start PostgreSQL, backend, and frontend using the commands above.
2. Open the frontend URL shown by Vite, usually `http://localhost:5173`.
3. Enter a product requirement in the textarea.
4. Enter the base URL of the application under test.
5. Click `Run Tests`.
6. Watch the run status update in the UI.

## API Example

Start a run. The response returns immediately with a `runId`; the run itself
continues in the background.

```sh
curl -X POST http://localhost:3000/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "prdText": "User should be able to login with valid and invalid credentials",
    "baseUrl": "https://the-internet.herokuapp.com/login"
  }'
```

Poll the run for its status and generated plan:

```sh
curl http://localhost:3000/agent-runs/<runId>
```

An unknown `runId` returns `{"status":"UNKNOWN","message":"Run not found"}`.

## Models Used

Model IDs are declared as constants at the top of
`backend/src/llm/llm.service.ts`:

- Planning and failure analysis: `claude-sonnet-4-6`
- Playwright code generation: `claude-haiku-4-5`

## Notes

- Generated run output is written under `backend/runs/{runId}/`
- The frontend reads the backend URL from `VITE_API_BASE_URL`
- The backend reads database and Anthropic settings from `backend/.env`
- Prisma is configured for PostgreSQL; the host port is whatever
  `POSTGRES_PORT` is set to, mapped to `5432` inside the container
- There is no `playwright.config.ts`; the runner invokes the Playwright CLI
  directly with the generated spec path

## Limitations

This is still a local POC:

- No authentication or authorisation on the API
- Runs execute in-process as fire-and-forget promises, so they do not survive a
  backend restart and there is no job queue or concurrency limit
- Generated test code is executed without sandboxing
- `TestCase` rows are created with status `PENDING` and are never updated from
  the Playwright results, so per-test outcomes live only in the HTML report
- `LlmService.analyseFailure` is implemented but not yet wired into the
  orchestrator, so the `EXECUTED` and `ANALYZED` statuses are unused

## License

This project is provided under the MIT License.
