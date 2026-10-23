#!/usr/bin/env node
// Optional: fine-tune an OpenAI model on Trump's real interview/debate answers,
// so the voice is in the weights and not only in the prompt.
//
// Each training example is a real question put to him and his real, verbatim
// answer from the transcript corpus.
//
//   node scripts/make-finetune.js            writes data/finetune.jsonl
//   node scripts/make-finetune.js --submit   also uploads it and starts a job
//
// Env: OPENAI_API_KEY, FT_BASE_MODEL (default gpt-4.1-mini-2025-04-14),
//      FT_EXAMPLES (default 3000). When the job finishes, set OPENAI_MODEL on
//      Render to the resulting ft:... model id.
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../lib/corpus');

const BASE = process.env.FT_BASE_MODEL || 'gpt-4.1-mini-2025-04-14';
const COUNT = Number(process.env.FT_EXAMPLES || 3000);
const SYSTEM = 'You are TrumpGPT, a satirical chatbot that talks exactly like Donald Trump.';
const out = path.join(__dirname, '..', 'data', 'finetune.jsonl');

const { spoken } = load();
const pairs = spoken
  .filter(p => p.q && p.t.length >= 200 && !/^(thank you|thanks)/i.test(p.t))
  .sort(() => Math.random() - 0.5)
  .slice(0, COUNT);

fs.writeFileSync(out, pairs.map(p => JSON.stringify({
  messages: [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: p.q },
    { role: 'assistant', content: p.t },
  ],
})).join('\n') + '\n');
console.log(`wrote ${pairs.length} examples to ${out}`);

async function submit() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Error('OPENAI_API_KEY is required for --submit');
  const form = new FormData();
  form.append('purpose', 'fine-tune');
  form.append('file', new Blob([fs.readFileSync(out)]), 'finetune.jsonl');
  const file = await (await fetch('https://api.openai.com/v1/files', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
  })).json();
  if (!file.id) throw Error('Upload failed: ' + JSON.stringify(file));
  const job = await (await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: BASE, training_file: file.id, suffix: 'trumpgpt' }),
  })).json();
  if (!job.id) throw Error('Job creation failed: ' + JSON.stringify(job));
  console.log(`fine-tune job ${job.id} started on ${BASE}. Track it at https://platform.openai.com/finetune`);
}

if (process.argv.includes('--submit')) submit().catch(e => { console.error(e.message); process.exit(1); });
