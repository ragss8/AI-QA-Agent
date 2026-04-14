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
- PostgreSQL installed locally on Windows
- Optional: `OPENAI_API_KEY`

## Environment Files

Backend env in `backend/.env`:

```env
DATABASE_URL="postgresql://Raghu:aiqatest123@localhost:5432/ai_qa_agent?schema=public"
OPENAI_API_KEY=
PORT=3000
```

Frontend env in `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

## How To Start The Project

Open three terminals from the repository root.

### 1. Start PostgreSQL

This project uses a local PostgreSQL cluster stored in `.postgres-data/`.

```powershell
& "C:\Program Files\PostgreSQL\18\bin\postgres.exe" -D ".postgres-data" -p 5432
```

Keep this terminal open while working.

### 2. Start The Backend

```powershell
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run start:dev
```

Backend URL:

```text
http://localhost:3000
```

### 3. Start The Frontend

```powershell
cd frontend
npm install
npm run dev
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
- Port: `5432`
- Database: `ai_qa_agent`
- Username: `Raghu`
- Password: `aiqatest123`

Reusable setup SQL:

```text
backend/prisma/setup-local-postgres.sql
```

## Notes

- Generated run output is written under `backend/runs/`
- The frontend reads the backend URL from `VITE_API_BASE_URL`
- The backend reads database and OpenAI settings from `backend/.env`
- Prisma is configured for PostgreSQL

## Limitations

This is still a local POC. It does not include authentication, production-grade
job execution, hardened sandboxing, or complete runtime persistence through
Prisma services.

## License

This project is provided under the MIT License.
