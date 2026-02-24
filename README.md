# Agentic AI QA Engineer (Local POC)

This repository contains a proof‑of‑concept implementation of an **agentic AI QA
assistant**.  The goal of this project is to demonstrate how a single agent can
behave like a QA engineer by planning tests from requirements, generating
executable browser tests, running them against a live application and
interpreting the results.  Everything in this repository is designed to run
locally using free tooling – there is no cloud infrastructure or SaaS
dependencies.

## What it does

* **Accepts requirements** – A plain text description of a feature or user story
  is posted to the API along with the base URL of the application under test.
* **Plans test cases** – The agent uses a language model to extract a list of
  happy‑path, negative and edge case scenarios from the provided PRD.
* **Generates Playwright tests** – For each test case the agent produces
  TypeScript code compatible with [Playwright](https://playwright.dev/).
* **Executes tests locally** – Playwright is invoked to run the generated test
  suite in a real browser.  The results, logs and screenshots are captured in
  the `runs` folder.
* **Analyses failures** – When a test fails the agent inspects the error logs
  and classifies the problem as an application bug, a flaky test or a selector
  issue.  In the case of flaky or selector issues the agent can regenerate
  tests and re‑execute them.

## Repository structure

```
ai-qa-agent/
├── README.md              Project overview and usage
└── backend/               NestJS based API and agent implementation
    ├── prisma/
    │   └── schema.prisma  Database schema for run and test case metadata
    ├── src/
    │   ├── main.ts        Bootstraps the NestJS application
    │   ├── app.module.ts  Root module wiring the controllers and services
    │   ├── agent/
    │   │   ├── agent.controller.ts  REST controller for starting runs
    │   │   ├── agent.orchestrator.ts Agent orchestration logic
    │   │   └── agent.types.ts   Shared type definitions
    │   ├── llm/
    │   │   └── llm.service.ts  Wrapper around the local or remote LLM
    │   └── playwright/
    │       └── playwright-runner.service.ts  Executes Playwright tests
    ├── package.json        Node dependencies and scripts
    └── tsconfig.json       TypeScript compiler configuration
```

## Getting started

> **Note** – This project is intended as a local proof of concept.  It does
> not include any deployment configuration, authentication or multi‑tenant
> infrastructure.  Before running the project ensure you have a current
> version of Node.js (>= 18) installed.  If you wish to use the OpenAI API
> you must export your `OPENAI_API_KEY` in the environment, or configure the
> LLM service to use a local model via [Ollama](https://ollama.ai/).

1. Install dependencies in the `backend` folder:

   ```sh
   cd backend
   npm install
   ```

2. Perform an initial Prisma migration.  The provided schema defines a
   simple `AgentRun` and `TestCase` model for persisting runs and results.

   ```sh
   npx prisma migrate dev --name init
   ```

3. Start the NestJS server in development mode.  It will watch for changes
   and rebuild automatically:

   ```sh
   npm run start:dev
   ```

4. Submit a run via `curl` or your favourite HTTP client.  Replace the
   `baseUrl` with the application under test.  The API will respond with a
   run identifier.  Poll `/agent-runs/{runId}` to watch the state progress
   through the planning, generation, execution and analysis stages.

   ```sh
   curl -X POST http://localhost:3000/agent-runs \
     -H "Content-Type: application/json" \
     -d '{
       "prdText": "User should be able to login with valid and invalid credentials",
       "baseUrl": "https://the-internet.herokuapp.com/login"
     }'
   ```

5. After the run completes the generated test suite and reports will be
   available in `backend/runs/{runId}`.  Playwright also produces an HTML
   report which can be viewed locally.

## Limitations

This proof of concept prioritises clarity over completeness.  It lacks many
features that would be required for a production system, including
authentication, concurrency control, robust error handling, sandboxed test
execution and CI/CD integration.  However, it demonstrates how an agent can
plan, act, observe and reflect using off‑the‑shelf tools and a language
model.

## License

This project is provided under the MIT License.  See [`LICENSE`](LICENSE) for
details.