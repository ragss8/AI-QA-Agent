import { OllamaProvider } from '../src/llm/ollama.provider';
import { FlowExplorerService } from '../src/page-inspector/flow-explorer.service';

/**
 * Compares candidate reasoning models on the task the code model fails at:
 * driving a login. Run after pulling a new model.
 *
 *   npx ts-node --project eval/tsconfig.json eval/compare-models.ts \
 *     qwen2.5-coder:7b-instruct-q4_K_M qwen3:8b
 *
 * The oracle is unambiguous: the agent either reaches /secure or it does not,
 * and a correct run fills the two fields before clicking. Three attempts each,
 * because the failure being measured is non-determinism, not a single slip.
 */

const URL = 'https://the-internet.herokuapp.com/login';
const GOAL =
  'Log in with username tomsmith and password SuperSecretPassword! and reach the secure area page';
const ATTEMPTS = 3;

async function trial(model: string) {
  process.env.OLLAMA_REASONING_MODEL = model;
  // Re-require so the provider re-reads the env var at module load.
  delete require.cache[require.resolve('../src/llm/ollama.provider')];
  const { OllamaProvider: Fresh } = await import('../src/llm/ollama.provider');
  const explorer = new FlowExplorerService(new (Fresh as typeof OllamaProvider)());

  const started = Date.now();
  const trace = await explorer.explore(URL, GOAL);
  const fills = trace.steps.filter((s) => s.action.startsWith('fill')).length;

  return {
    reached: trace.reachedGoal,
    steps: trace.steps.length - 1,
    fills,
    seconds: Math.round((Date.now() - started) / 1000),
    stopped: trace.stoppedBecause,
  };
}

async function main() {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    console.error('usage: compare-models.ts <model> [<model> …]');
    process.exitCode = 1;
    return;
  }

  for (const model of models) {
    console.log(`\n=== ${model} ===`);
    let reachedCount = 0;

    for (let i = 1; i <= ATTEMPTS; i++) {
      try {
        const r = await trial(model);
        if (r.reached) reachedCount++;
        console.log(
          `  attempt ${i}: ${r.reached ? 'REACHED  ' : 'failed   '} ` +
            `${r.steps} actions, ${r.fills} fill(s), ${r.seconds}s` +
            (r.stopped ? `  — ${r.stopped.slice(0, 80)}` : ''),
        );
      } catch (error) {
        console.log(`  attempt ${i}: ERROR ${(error as Error).message.slice(0, 80)}`);
      }
    }

    console.log(`  → reached the goal ${reachedCount}/${ATTEMPTS} times`);
  }
  console.log('\nA usable reasoning model reaches the goal every time and uses 2 fills.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
