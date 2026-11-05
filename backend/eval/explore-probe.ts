import { FlowExplorerService } from '../src/page-inspector/flow-explorer.service';
import { OllamaProvider } from '../src/llm/ollama.provider';
async function main() {
  const trace = await new FlowExplorerService(new OllamaProvider()).explore(process.argv[2], process.argv[3]);
  console.log(`RESULT reachedGoal=${trace.reachedGoal} steps=${trace.steps.length} stopped=${trace.stoppedBecause ?? '-'}`);
  trace.steps.forEach(s => console.log(`  ${s.index}. ${s.action}`));
}
main().catch(e => console.error('FAILED:', e.message));
