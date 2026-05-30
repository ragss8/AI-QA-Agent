# Agentic AI QA Engineer

This repository contains a local proof-of-concept AI QA assistant. The project
accepts a product requirement, generates a test plan, creates Playwright test
code, runs the tests locally, and exposes run status through a NestJS backend
and a Vite/React frontend.

## What It Does

- Accepts product requirements and a target base URL
- Generates a test plan with happy, negative, and edge-case scenarios
- Produces Playwright test code from the generated plan
- Runs tests locally and stores artifacts under `backend/runs/`
- Exposes run status through the backend API and frontend UI

## Repository Structure

```text
ai-qa-agent/
|-- README.md
|-- .gitignore
|-- .postgres-data/
|-- backend/
|   |-- .env.example
|   |-- prisma/
|   |   |-- schema.prisma
|   |   `-- setup-local-postgres.sql
|   |-- src/
|   `-- package.json
`-- frontend/
    |-- .env.example
    |-- src/
    `-- package.json
```

## Prerequisites

- Node.js 18+
- npm
- Required: `ANTHROPIC_API_KEY`

## Environment Files

Backend envs in `backend/.env.example`:
Create a .env file by giving values of your own for the fields present in .env.example

Frontend envs in `frontend/.env.example`:
Create a .env file by giving values of your own for the fields present in .env.example

## How To Start The Project

### 1. Install Backend Dependencies

cd backend
pnpm install
sudo pnpm exec playwright install-deps

### 2. Start PostgreSQL

Give POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT in the .env file and run 
docker compose up -d from inside the backend directory and wait for postgres to be up

### 2. Start The Backend

```terminal
Give POSTGRES_HOST, ANTHROPIC_API_KEY and PORT envs and run below two commands
npx prisma migrate dev --name init
pnpm run start:dev
```

Backend URL:

```text
http://localhost:3000
```

### 3. Start The Frontend

```terminal
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

You can also trigger a run directly through the backend API:

```sh
curl -X POST http://localhost:3000/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "prdText": "User should be able to login with valid and invalid credentials",
    "baseUrl": "https://the-internet.herokuapp.com/login"
  }'
```

## Local Database Notes

- Host: `localhost`
- Port: `5432` or `5433`

## Notes

- Generated run output is written under `backend/runs/{runId}/`
- The frontend reads the backend URL from `VITE_API_BASE_URL`
- The backend reads database and OpenAI settings from `backend/.env`
- Prisma is configured for PostgreSQL

## Limitations

This is still a local POC. It does not include authentication, production-grade
job execution, hardened sandboxing, or complete runtime persistence through
Prisma services.

## License

This project is provided under the MIT License.
