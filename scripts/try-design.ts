/**
 * Try the AI page designer on a PDF of your own, against the real Claude API, and see what it costs.
 *
 *   npm run try:design -- path/to/file.pdf             uses the key in .env
 *   npm run try:design -- path/to/file.pdf --json page.json     also writes the page it made
 *
 * The PDF is imported into a throwaway database (nothing is saved). The output is the blocks of the page, the import
 * report (it says why, if Claude's design was not used), and for each call to Claude how long it took and how many tokens
 * it used, with an estimate of what that cost at Anthropic's list prices when this was written.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadDotEnv } from '../src/server/config';
import { closeContext, createContext } from '../src/server/context';
import { importPdfCampaign } from '../src/server/services/importer';
import { AnthropicBackend, setAiBackend, type AiBackend } from '../src/server/services/ai';

/** US dollars per million tokens (input, output), by the family named in the model id. */
const PRICES: Array<[RegExp, number, number]> = [
  [/opus-5/, 4, 20],
  [/haiku-5/, 0.1, 0.5],
];

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--json');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;
if (!file) {
  console.error('Usage: npm run try:design -- path/to/file.pdf [--json out.json]');
  process.exit(2);
}

loadDotEnv();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multiplier-try-'));
const config = loadConfig({ ...process.env, DATA_DIR: tmp, LOG_LEVEL: 'error' });
if (!config.anthropicApiKey) {
  console.error('There is no ANTHROPIC_API_KEY in .env or the environment, so there is nothing to try.');
  process.exit(2);
}
const ctx = createContext(config, { dbFile: ':memory:', quiet: true });

const calls: Array<{ label: string; model: string; seconds: number; input: number; output: number; ok: boolean }> = [];
const real = new AnthropicBackend(config.anthropicApiKey, { workspaceId: config.anthropicWorkspaceId });
const timed: AiBackend = {
  async complete(call) {
    const started = Date.now();
    const res = await real.complete(call);
    calls.push({
      label: call.label,
      model: call.model,
      seconds: (Date.now() - started) / 1000,
      input: res.ok ? (res.usage?.input_tokens ?? 0) : 0,
      output: res.ok ? (res.usage?.output_tokens ?? 0) : 0,
      ok: res.ok,
    });
    return res;
  },
};
setAiBackend(ctx, timed);

try {
  const data = fs.readFileSync(file);
  const started = Date.now();
  const { campaign, report } = await importPdfCampaign(ctx, { data, filename: path.basename(file), ai: true });
  const seconds = (Date.now() - started) / 1000;

  console.log(`\n${path.basename(file)}: imported in ${seconds.toFixed(1)}s\n`);
  console.log('Blocks:');
  campaign.page.blocks.forEach((b, i) => {
    const said = (b as { heading?: string; headline?: string; text?: string; quote?: string }) ?? {};
    const title = (said.headline ?? said.heading ?? said.text ?? said.quote ?? '').replace(/\s+/g, ' ').slice(0, 70);
    console.log(`  ${String(i + 1).padStart(2)}. ${b.type.padEnd(11)} ${title}`);
  });
  console.log('\nImport report:');
  for (const line of report) console.log(`  - ${line}`);

  console.log('\nCalls to Claude:');
  let total = 0;
  for (const c of calls) {
    const price = PRICES.find(([re]) => re.test(c.model));
    const cost = price ? (c.input * price[1] + c.output * price[2]) / 1_000_000 : null;
    if (cost) total += cost;
    console.log(
      `  ${c.label.padEnd(14)} ${c.model.padEnd(18)} ${c.seconds.toFixed(1).padStart(5)}s  ${String(c.input).padStart(7)} in  ${String(c.output).padStart(6)} out` +
        `  ${c.ok ? '' : 'FAILED  '}${cost === null ? '(no price known for this model)' : `~$${cost.toFixed(3)}`}`,
    );
  }
  if (!calls.length) console.log('  (none: AI was not asked)');
  else console.log(`  total ~$${total.toFixed(3)} at list prices when this was written; the Console's usage page has the real figure`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(campaign.page, null, 2));
    console.log(`\nThe page was written to ${jsonOut}`);
  }
} finally {
  closeContext(ctx);
  fs.rmSync(tmp, { recursive: true, force: true });
}
