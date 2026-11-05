import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';
import {
  ExplorerAction,
  FlowTrace,
  PlannedTestCase,
  TestPlan,
} from '../agent/agent.types';
import {
  ANALYSIS_SYSTEM_PROMPT,
  EXPLORER_ACTION_SCHEMA,
  EXPLORER_SYSTEM_PROMPT,
  FAILURE_ANALYSIS_SCHEMA,
  FailureAnalysis,
  LlmProvider,
  PLAN_SYSTEM_PROMPT,
  SPEC_SYSTEM_PROMPT,
  TEST_PLAN_SCHEMA,
  buildPlanPrompt,
  buildSpecPrompt,
} from './llm-provider';

const HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

/**
 * Two models, because this pipeline asks for two unrelated skills.
 *
 * Exploration and planning are agentic reasoning: read a screen, decide the
 * next action, enumerate scenarios. Code generation is writing TypeScript.
 * A code-completion-specialised model measurably excels at the second and is
 * unreliable at the first — on repeat runs it chose `click` on a text input
 * instead of `fill`, failing a login it had completed minutes earlier.
 *
 * Both default to the coder, so behaviour is unchanged until a reasoning model
 * is pulled and `OLLAMA_REASONING_MODEL` set. They load sequentially rather
 * than together: on 16 GB, two resident models plus Chromium would swap.
 */
const CODEGEN_MODEL =
  process.env.OLLAMA_CODEGEN_MODEL ??
  process.env.OLLAMA_MODEL ??
  'qwen2.5-coder:7b-instruct-q4_K_M';

const REASONING_MODEL =
  process.env.OLLAMA_REASONING_MODEL ??
  process.env.OLLAMA_MODEL ??
  CODEGEN_MODEL;

/**
 * Ollama defaults to a 4096-token window regardless of what the model supports,
 * and silently truncates beyond it. A 3000-character page plus the test cases
 * plus generated output runs close to that, so set it explicitly.
 */
const NUM_CTX = 8192;
const NUM_PREDICT = 4096;

/**
 * Thinking models (Qwen3 and later) reason before answering, which this
 * pipeline mostly does not need: the JSON schema already constrains the shape,
 * and measured on the explorer's action choice, thinking produced the identical
 * answer in 27s instead of 5s — 611 output tokens instead of 99.
 *
 * So it is off by default everywhere: the measured benefit was zero and the
 * measured cost was 5x.
 *
 * `think: true` is opt-in, and only valid on a model that supports thinking —
 * Ollama rejects it outright on others ("does not support thinking"), it does
 * not ignore it. `think: false` is accepted by every model, so that is the safe
 * value to send unconditionally.
 */
const THINK_WHILE_EXPLORING = process.env.OLLAMA_THINK_EXPLORE === 'true';
const THINK_WHILE_PLANNING = process.env.OLLAMA_THINK_PLAN === 'true';

@Injectable()
export class OllamaProvider extends LlmProvider {
  readonly name = 'ollama';
  readonly model =
    REASONING_MODEL === CODEGEN_MODEL
      ? CODEGEN_MODEL
      : `${REASONING_MODEL} (reasoning) + ${CODEGEN_MODEL} (codegen)`;

  private readonly client = new Ollama({ host: HOST });
  private readonly logger = new Logger(OllamaProvider.name);

  async generateTestPlan(prdText: string, trace?: FlowTrace): Promise<TestPlan> {
    // `format` constrains the sampler to the schema, so malformed JSON is
    // structurally impossible. This replaces Anthropic's forced tool call.
    const response = await this.client.chat({
      model: REASONING_MODEL,
      stream: false,
      think: THINK_WHILE_PLANNING,
      format: TEST_PLAN_SCHEMA,
      options: { temperature: 0, num_ctx: NUM_CTX },
      messages: [
        { role: 'system', content: PLAN_SYSTEM_PROMPT },
        { role: 'user', content: buildPlanPrompt(prdText, trace) },
      ],
    });

    return this.parseJson<TestPlan>(response.message.content, 'a test plan');
  }

  async generatePlaywrightSpec(
    testCases: PlannedTestCase[],
    baseUrl: string,
    pageContext: string,
  ): Promise<string> {
    // No `format` here: the output is TypeScript, not JSON, so there is no
    // schema to enforce. This is why the repair loop exists.
    const response = await this.client.chat({
      model: CODEGEN_MODEL,
      stream: false,
      options: { temperature: 0, num_ctx: NUM_CTX, num_predict: NUM_PREDICT },
      messages: [
        { role: 'system', content: SPEC_SYSTEM_PROMPT },
        { role: 'user', content: buildSpecPrompt(testCases, baseUrl, pageContext) },
      ],
    });

    const spec = stripCodeFences(response.message.content);
    if (!spec) {
      throw new Error('LLM did not return a Playwright spec');
    }
    return spec;
  }

  async chooseAction(
    goal: string,
    pageMarkup: string,
    history: string[],
  ): Promise<ExplorerAction> {
    const response = await this.client.chat({
      model: REASONING_MODEL,
      stream: false,
      think: THINK_WHILE_EXPLORING,
      format: EXPLORER_ACTION_SCHEMA,
      options: { temperature: 0, num_ctx: NUM_CTX },
      messages: [
        { role: 'system', content: EXPLORER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Goal:\n${goal}\n\nDone so far:\n${history.join('\n') || '(nothing yet)'}\n\nCurrent screen:\n${pageMarkup}`,
        },
      ],
    });

    return this.parseJson<ExplorerAction>(response.message.content, 'an explorer action');
  }

  async analyseFailure(
    testCase: PlannedTestCase,
    errorLog: string,
  ): Promise<FailureAnalysis> {
    const response = await this.client.chat({
      model: REASONING_MODEL,
      stream: false,
      think: THINK_WHILE_EXPLORING,
      format: FAILURE_ANALYSIS_SCHEMA,
      options: { temperature: 0, num_ctx: NUM_CTX },
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Test: ${JSON.stringify(testCase)}\n\nError log:\n${errorLog}`,
        },
      ],
    });

    return this.parseJson<FailureAnalysis>(response.message.content, 'a failure analysis');
  }

  // Schema-constrained output still arrives as a JSON *string*, not an object.
  private parseJson<T>(content: string, expected: string): T {
    try {
      return JSON.parse(content) as T;
    } catch {
      this.logger.error(`Expected ${expected}, got: ${content.slice(0, 200)}`);
      throw new Error(`LLM did not return ${expected}`);
    }
  }
}

/**
 * Small models add markdown fences even when told not to, and a fence makes the
 * spec fail to compile for a reason that has nothing to do with the test logic.
 */
export function stripCodeFences(raw: string): string {
  const text = raw.trim();
  const fenced = /^```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}
