// Render's free tier has 512 MB. A capped heap makes V8 collect garbage
// sooner instead of growing toward the limit, so re-launch with the cap if
// the start command didn't set one.
if (!process.execArgv.some(a => a.startsWith('--max-old-space-size'))) {
  const child = require('node:child_process').spawn(process.execPath,
    ['--max-old-space-size=300', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
  return;
}
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { load, POSTS } = require('./lib/corpus');
const corpus = load();
const { instructions } = require('./lib/persona');
const { startLiveUpdates } = require('./lib/live');
const voice = require('./lib/voice');

const PORT = Number(process.env.PORT || 3000);
const API_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
// Reasoning models (o-series, gpt-5) reject temperature; others get a bit of
// extra randomness for variety unless TEMPERATURE overrides it.
const TEMPERATURE = process.env.TEMPERATURE ? Number(process.env.TEMPERATURE)
  : /^(gpt-4|ft:gpt-4)/.test(MODEL) ? 1.1 : undefined;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR || 150);
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

// Combative posts make better style samples than event announcements.
const punchy = p => /!/.test(p.t) &&
  /\b[A-Z]{4,}\b|\b(Sad|Weak|Fake|loser|dumb|failing|Crooked|Sleepy|rigged|disgrace|corrupt|lunatic|witch hunt|deranged)\b/i.test(p.t);
let ANSWERS, PUNCHY_OLD, PUNCHY_NEW;
function pools() {
  ANSWERS = corpus.spoken.filter(p => p.q);
  PUNCHY_OLD = corpus.posts.filter(p => p.g === 'tweet' && punchy(p));
  PUNCHY_NEW = corpus.recentPosts.filter(punchy);
}
pools();
const reportCorpus = () => console.log(`Corpus: ${corpus.stats.spoken} spoken passages, ${corpus.stats.posts} posts, latest ${corpus.stats.latest}`);
reportCorpus();
const add = corpus.add;
corpus.add = more => { add(more); pools(); reportCorpus(); };
startLiveUpdates(corpus);

// Pick reference material for this turn: the passages most relevant to the
// conversation, random samples weighted toward his recent voice so it
// doesn't collapse onto one topic, and his latest posts for current events.
function references(messages) {
  const users = messages.filter(m => m.role === 'user').map(m => m.content);
  const query = users.slice(-2).join(' ');
  const relevantSpoken = corpus.search(query, { limit: 3, filter: p => !POSTS.has(p.g) });
  const relevantPosts = corpus.search(query, { limit: 8, filter: p => POSTS.has(p.g) });
  return {
    spoken: [...relevantSpoken, ...corpus.sample(ANSWERS, 1)],
    posts: [...relevantPosts, ...corpus.sample(PUNCHY_NEW, 6), ...corpus.sample(PUNCHY_OLD, 2)],
    latest: corpus.latest(15),
  };
}

// Belt and braces for the "no em dashes" rule in the persona.
const scrubDashes = s => s.replace(/(\d)[—–](\d)/g, '$1-$2').replace(/\s*[—–]\s*/g, ', ');

const hits = new Map(); // ip -> timestamps in the last hour
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

function validMessages(messages) {
  return Array.isArray(messages) && messages.length > 0 && messages.length <= 40 &&
    messages.every(m => ['user', 'assistant'].includes(m?.role) &&
      typeof m.content === 'string' && m.content.length <= 4000) &&
    messages.at(-1).role === 'user';
}

async function readBody(req, max = 100_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > max) throw Object.assign(Error('Request too large'), { status: 413 });
  }
  return JSON.parse(raw);
}

// Streams the reply to the client as newline-delimited JSON:
//   {"sources":[...]}  then {"d":"text"}...  then {"done":true} or {"error":"..."}
async function chat(req, res) {
  const send = obj => res.write(JSON.stringify(obj) + '\n');
  const { messages } = await readBody(req);
  if (!validMessages(messages)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid conversation' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });

  const refs = references(messages);
  send({ sources: [...refs.spoken.slice(0, 2), ...refs.posts.slice(0, 5)].map(p => ({ g: p.g, d: p.d, t: p.t.slice(0, 280) })) });

  const upstream = await fetch(`${API_BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      instructions: instructions(refs, new Date().toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'America/New_York' })),
      input: messages,
      max_output_tokens: 1200,
      stream: true,
      ...(TEMPERATURE !== undefined && { temperature: TEMPERATURE }),
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!upstream.ok) {
    const body = await upstream.text();
    console.error('OpenAI error', upstream.status, body.slice(0, 500));
    send({ error: upstream.status === 429
      ? 'Rate limited or out of OpenAI credits. Try again shortly.'
      : 'The AI request failed. Check the API key, credits and OPENAI_MODEL.' });
    return res.end();
  }

  // Relay OpenAI's server-sent events as text deltas.
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of upstream.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let event;
      try { event = JSON.parse(line.slice(5)); } catch { continue; }
      if (event.type === 'response.output_text.delta') send({ d: scrubDashes(event.delta) });
      else if (event.type === 'error' || event.type === 'response.failed') {
        console.error('OpenAI stream error', JSON.stringify(event).slice(0, 500));
        send({ error: 'The AI stream failed. Please retry.' });
      }
    }
  }
  send({ done: true });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(INDEX);
    }
    if (req.method === 'GET' && req.url === '/api/status') {
      return json(200, { ready: Boolean(process.env.OPENAI_API_KEY), model: MODEL, corpus: corpus.stats });
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      if (!process.env.OPENAI_API_KEY) return json(503, { error: 'OPENAI_API_KEY is not set on the server.' });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (rateLimited(ip)) return json(429, { error: 'Too many messages. Slow down, low energy.' });
      return await chat(req, res);
    }
    if (req.method === 'POST' && (req.url === '/api/tts' || req.url === '/api/transcribe')) {
      if (!process.env.OPENAI_API_KEY) return json(503, { error: 'OPENAI_API_KEY is not set on the server.' });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (rateLimited(ip)) return json(429, { error: 'Too many requests. Slow down, low energy.' });
      return await (req.url === '/api/tts' ? voice.tts(req, res, readBody) : voice.transcribe(req, res));
    }
    json(404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return json(err.status || 500, { error: err.status ? err.message : 'Server error. Please retry.' });
    res.end(JSON.stringify({ error: 'Server error. Please retry.' }) + '\n');
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`TrumpGPT listening on ${PORT} (model ${MODEL})`));
