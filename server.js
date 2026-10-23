const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const corpus = require('./lib/corpus').load();
const { PERSONA, referenceBlock } = require('./lib/persona');

const PORT = Number(process.env.PORT || 3000);
const API_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const TEMPERATURE = process.env.TEMPERATURE ? Number(process.env.TEMPERATURE) : undefined;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR || 60);
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const ANSWERS = corpus.spoken.filter(p => p.q);
// Combative posts make better style samples than event announcements.
const PUNCHY = corpus.tweets.filter(p => /!/.test(p.t) &&
  /\b[A-Z]{4,}\b|\b(Sad|Weak|Fake|loser|dumb|failing|Crooked|Sleepy|rigged|disgrace|overrated|haters)\b/i.test(p.t));
console.log(`Corpus loaded: ${corpus.stats.spoken} spoken passages, ${corpus.stats.tweets} posts`);

// Pick reference material for this turn: the passages most relevant to the
// conversation, topped up with random posts so the voice doesn't collapse
// onto one topic.
function references(messages) {
  const users = messages.filter(m => m.role === 'user').map(m => m.content);
  const query = users.slice(-2).join(' ');
  const relevantSpoken = corpus.search(query, { limit: 3, filter: p => p.g !== 'tweet' });
  const relevantTweets = corpus.search(query, { limit: 6, filter: p => p.g === 'tweet' });
  const spoken = [...relevantSpoken, ...corpus.sample(ANSWERS, 2)];
  const tweets = [...relevantTweets, ...corpus.sample(PUNCHY, 6)];
  return { spoken, tweets };
}

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
  send({ sources: [...refs.spoken.slice(0, 3), ...refs.tweets.slice(0, 4)].map(p => ({ g: p.g, d: p.d, t: p.t.slice(0, 280) })) });

  const upstream = await fetch(`${API_BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      instructions: PERSONA + referenceBlock(refs),
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
      if (event.type === 'response.output_text.delta') send({ d: event.delta });
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
    json(404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return json(err.status || 500, { error: err.status ? err.message : 'Server error. Please retry.' });
    res.end(JSON.stringify({ error: 'Server error. Please retry.' }) + '\n');
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`TrumpGPT listening on ${PORT} (model ${MODEL})`));
