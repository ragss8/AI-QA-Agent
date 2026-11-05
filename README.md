# Agentic AI QA Engineer

This repository contains a local proof-of-concept AI QA assistant. The project
accepts a product requirement, generates a test plan, inspects the target page,
creates Playwright test code, runs the tests locally, and exposes run status
through a NestJS backend and a Vite/React frontend.

## What It Does

- Runs on a local Qwen model by default, or the Anthropic API when a funded key is present
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
- [Ollama](https://ollama.com) with a model pulled (see below). This is the default engine.
- `ANTHROPIC_API_KEY` — **optional**. When set and funded it is preferred; otherwise the
  local model serves every call.

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

### 3. Pull The Local Models

```sh
brew install ollama
OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve   # leave running

ollama pull qwen2.5-coder:7b-instruct-q4_K_M   # 4.7 GB — writes the spec
ollama pull qwen3:8b                           # 5.2 GB — explores and plans
```

The two environment variables shrink the KV cache, which matters on a 16 GB
machine. If you pull only the coder, set both model variables to it and the app
still works — see *Choosing Local Models* below.

### 4. Start The Backend

With `POSTGRES_HOST`, `ANTHROPIC_API_KEY`, and `PORT` also set:

```sh
pnpm prisma:migrate
pnpm run start:dev
```

Backend URL:

```text
http://localhost:3000
```

### 5. Start The Frontend

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

## Which Engine Serves A Run

Every LLM backend implements `LlmProvider` (`backend/src/llm/llm-provider.ts`).
The default stack, assembled in `app.module.ts`, is:

```text
RepairingLlmProvider( RoutingLlmProvider( AnthropicProvider, OllamaProvider ) )
```

- **Routing** prefers Anthropic while the key works. There is no API for asking
  whether a key has credits, so failures are classified by status: 401/403 is
  permanent, 402 and a spend-cap 429 fall back for an hour, an ordinary 429 or a
  5xx falls back for one call, and a 400 is logged rather than treated as a
  billing problem.
- **Repair** re-prompts with `tsc` errors when a generated spec does not
  compile, up to two retries. It costs nothing when the spec already compiles.

Each run records the backend that served it in `AgentRun.provider` / `.model`.

Model IDs are constants at the top of each provider:

| Provider | Planning / analysis | Code generation |
| -------- | ------------------- | --------------- |
| `anthropic.provider.ts` | `claude-sonnet-4-6` | `claude-haiku-4-5` |
| `ollama.provider.ts` | `qwen2.5-coder:7b-instruct-q4_K_M` | same |

## Choosing Local Models

The pipeline needs two unrelated skills, and one model is rarely good at both:

| Stage | Skill | Variable |
| ----- | ----- | -------- |
| Explore the app, plan cases, analyse failures | agentic reasoning, tool use | `OLLAMA_REASONING_MODEL` |
| Generate the Playwright spec | writing TypeScript | `OLLAMA_CODEGEN_MODEL` |

Both fall back to `OLLAMA_MODEL`, then to the coder, so a single-model setup
works unchanged.

Measured on an M1 Pro / 16 GB with `qwen2.5-coder:7b-instruct-q4_K_M`:

- **Code generation: strong.** Every spec compiled, on all six eval cases.
- **Exploration: unreliable.** On repeat runs it chose `click` on a text input
  instead of `fill`, failing a login it had completed minutes earlier. It is a
  code-completion model being asked to make agentic decisions.

So pair it with a general instruct model for the reasoning half. Compare
candidates on the task the coder fails:

```sh
npx ts-node --project eval/tsconfig.json eval/compare-models.ts \
  qwen2.5-coder:7b-instruct-q4_K_M qwen3:8b
```

### What fits in 16 GB

Measured concurrently, with the model loaded at `num_ctx: 8192` and headless
Chromium live during exploration:

| Model | Weights | Model + browser | Verdict |
| ----- | ------- | --------------- | ------- |
| 7B `q4_K_M` | 4.7 GB | **4.79 GB** | fits, ~7 GB spare |
| 14B `q4_K_M` | 9.0 GB | ~11.3 GB | swaps mid-run |
| 32B / Qwen3-Coder-30B-A3B | 19–20 GB | — | exceeds total RAM |

Headless Chromium is only ~0.3 GB across its processes, so the browser is not
the problem; the model is. Two models total ~10 GB of weights, so they load
**sequentially** rather than together — the stages are sequential anyway, and
Ollama swaps between them. If you see swapping, lower `keep_alive` so the
reasoning model unloads before code generation starts.

## Scoring The Engines

```sh
pnpm eval                       # local model
pnpm eval -- --provider anthropic
pnpm eval -- --repair           # with the compile-repair loop
pnpm eval -- --run              # also execute the specs (slow)
```

Six frozen cases under `backend/eval/`, scored objectively with no human and no
judge model: `+1` valid plan covering all three test types, `+2` the spec
compiles, `+2` every test passes, `-3` it used a selector absent from the page
markup. Page markup is cached in `eval/fixtures/`, so runs are fast and offline.

Two cases are marked as not memorisable — a synthetic page and a real private
app — because scores on well-known public test sites measure recall as much as
reasoning.

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
- `analyseFailure` is implemented on both providers but not yet wired into the
  orchestrator, so the `EXECUTED` and `ANALYZED` statuses are unused
- The local 7B model scores well below the hosted models on code generation. It
  reliably produces compiling specs, but invents CSS class selectors for
  elements absent from the extracted markup (such as error banners)

## License

This project is provided under the MIT License.
