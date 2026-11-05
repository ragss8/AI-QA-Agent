import { Injectable, Logger } from '@nestjs/common';
import {
  ExplorerAction,
  FlowTrace,
  PlannedTestCase,
  TestPlan,
} from '../agent/agent.types';
import { AnthropicProvider } from './anthropic.provider';
import { FailureAnalysis, LlmProvider } from './llm-provider';
import { OllamaProvider } from './ollama.provider';

/** How long to stay on the local model after a billing or spend-cap failure. */
const COOLDOWN_MS = 60 * 60 * 1000;

type Verdict =
  | { kind: 'use-anthropic' }
  | { kind: 'use-local'; permanent: boolean; until: number; reason: string };

/**
 * Prefers Anthropic while the key works, and falls back to the local model
 * otherwise.
 *
 * There is no endpoint to ask whether a key has credits, so the only way to
 * know is to make a call and classify the failure. The verdict is cached: a
 * permanent failure (bad key) is never retried, and a billing or spend-cap
 * failure is retried after a cooldown rather than on every request.
 */
@Injectable()
export class RoutingLlmProvider extends LlmProvider {
  readonly name = 'routing';

  private readonly logger = new Logger(RoutingLlmProvider.name);
  private verdict: Verdict = { kind: 'use-anthropic' };

  /** Which backend served the most recent call; the orchestrator persists it. */
  private lastUsed: LlmProvider;

  constructor(
    private readonly anthropic: AnthropicProvider,
    private readonly local: OllamaProvider,
  ) {
    super();
    this.lastUsed = local;
    if (!anthropic.isConfigured) {
      this.verdict = {
        kind: 'use-local',
        permanent: true,
        until: Infinity,
        reason: 'ANTHROPIC_API_KEY is not set',
      };
      this.logger.log('No Anthropic key configured; using the local model.');
    }
  }

  get model(): string {
    return this.lastUsed.model;
  }

  /** The backend that served the last call, for persisting on the run. */
  override get servedBy(): string {
    return this.lastUsed.servedBy;
  }

  generateTestPlan(prdText: string, trace?: FlowTrace): Promise<TestPlan> {
    return this.dispatch((p) => p.generateTestPlan(prdText, trace));
  }

  chooseAction(goal: string, pageMarkup: string, history: string[]): Promise<ExplorerAction> {
    return this.dispatch((p) => p.chooseAction(goal, pageMarkup, history));
  }

  generatePlaywrightSpec(
    testCases: PlannedTestCase[],
    baseUrl: string,
    pageContext: string,
  ): Promise<string> {
    return this.dispatch((p) =>
      p.generatePlaywrightSpec(testCases, baseUrl, pageContext),
    );
  }

  analyseFailure(
    testCase: PlannedTestCase,
    errorLog: string,
  ): Promise<FailureAnalysis> {
    return this.dispatch((p) => p.analyseFailure(testCase, errorLog));
  }

  private async dispatch<T>(call: (provider: LlmProvider) => Promise<T>): Promise<T> {
    if (!this.shouldTryAnthropic()) {
      this.lastUsed = this.local;
      return call(this.local);
    }

    try {
      this.lastUsed = this.anthropic;
      return await call(this.anthropic);
    } catch (error) {
      const classified = classify(error);
      this.logger.warn(
        `Anthropic call failed (${classified.reason}); falling back to ${this.local.name}.`,
      );

      if (classified.remember) {
        this.verdict = {
          kind: 'use-local',
          permanent: classified.permanent,
          until: classified.permanent ? Infinity : Date.now() + COOLDOWN_MS,
          reason: classified.reason,
        };
      }

      this.lastUsed = this.local;
      return call(this.local);
    }
  }

  private shouldTryAnthropic(): boolean {
    if (this.verdict.kind === 'use-anthropic') {
      return true;
    }
    if (this.verdict.permanent) {
      return false;
    }
    if (Date.now() >= this.verdict.until) {
      this.logger.log('Anthropic cooldown elapsed; re-probing.');
      this.verdict = { kind: 'use-anthropic' };
      return true;
    }
    return false;
  }
}

interface Classification {
  reason: string;
  /** Cache this verdict rather than re-trying Anthropic on the next call. */
  remember: boolean;
  /** Never retry (as opposed to retrying after the cooldown). */
  permanent: boolean;
}

/**
 * Maps a failure onto a routing decision. Keyed on HTTP status rather than the
 * SDK's exception classes because 402 has no dedicated class.
 */
export function classify(error: unknown): Classification {
  const status = (error as { status?: number })?.status;
  const headers = (error as { headers?: Record<string, string> })?.headers;

  switch (status) {
    case 401:
    case 403:
      // Key is malformed, revoked or lacks permission. Retrying cannot help.
      return { reason: `auth error (${status})`, remember: true, permanent: true };

    case 402:
      // The real "out of credits" signal.
      return { reason: 'billing error (402)', remember: true, permanent: false };

    case 429: {
      // Ordinary throttling carries retry-after. A monthly spend cap does not,
      // and will keep failing, so it must not be treated as transient.
      const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After'];
      return retryAfter
        ? { reason: 'rate limited (429, transient)', remember: false, permanent: false }
        : { reason: 'spend cap reached (429, no retry-after)', remember: true, permanent: false };
    }

    case 400:
      // Ambiguous: a spend limit, or a bug in our own request. Never cache this
      // as "no credits" or a schema bug looks like a billing problem for a week.
      return { reason: 'bad request (400) — check the request, not the balance', remember: false, permanent: false };

    default:
      // 5xx, 529, timeouts, connection errors: transient.
      return {
        reason: status ? `server error (${status})` : 'network or unknown error',
        remember: false,
        permanent: false,
      };
  }
}
