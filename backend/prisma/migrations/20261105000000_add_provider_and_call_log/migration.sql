-- Record which LLM backend served each run.
ALTER TABLE "AgentRun" ADD COLUMN "provider" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN "model" TEXT;

-- Accepted prompt/output pairs, kept as a distillation corpus.
CREATE TABLE "LlmCallLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCallLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LlmCallLog_provider_kind_idx" ON "LlmCallLog"("provider", "kind");
