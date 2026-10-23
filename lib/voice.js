// Voice mode: speech-to-text for the mic button and text-to-speech for
// replies, both through OpenAI. The voice is a stock OpenAI voice steered by
// delivery instructions (accent, cadence, attitude). It is not a clone of
// anyone's real voice.
const API_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const TTS_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'onyx';
const STT_MODEL = process.env.STT_MODEL || 'gpt-4o-mini-transcribe';
const auth = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });

const DELIVERY = `Voice: a brash, older New York real-estate mogul in his late seventies. Slightly hoarse and nasal, a little breathy, Queens accent ("yuge", "tremendous" with the stress on MEN, "believe me" landing hard). Never sound like a narrator or an assistant.
Delivery: an off-the-cuff rally speaker who loves the sound of his own voice. Short punchy phrases with pauses before the punchline. Stretches superlatives ("the best, the BEST, nobody's ever seen anything like it"). Repeats things for effect. Speeds up and gets louder when aggrieved or complaining about enemies, then drops to a confiding, almost conspiratorial tone on asides like "and by the way" or "a lot of people don't know this". Smug and self-satisfied when bragging, sarcastic and mocking when dismissing someone.
Pacing: unhurried and rhythmic, with dramatic beats. Not monotone.`;

async function readRaw(req, max) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(Error('Recording too long'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// POST /api/tts {text} -> audio/mpeg, streamed through as it's generated.
async function tts(req, res, readJson) {
  const { text } = await readJson(req);
  if (typeof text !== 'string' || !text.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No text' }));
  }
  const upstream = await fetch(`${API_BASE}/audio/speech`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text.slice(0, 4000),
      instructions: DELIVERY,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!upstream.ok) {
    console.error('TTS error', upstream.status, (await upstream.text()).slice(0, 500));
    res.writeHead(502, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Voice failed. Try again.' }));
  }
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

// POST /api/transcribe (raw audio body) -> {text}
async function transcribe(req, res) {
  const audio = await readRaw(req, 15_000_000);
  const type = (req.headers['content-type'] || 'audio/webm').split(';')[0];
  const ext = type.includes('mp4') || type.includes('m4a') || type.includes('aac') ? 'm4a'
    : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : type.includes('mpeg') ? 'mp3' : 'webm';
  const form = new FormData();
  form.append('model', STT_MODEL);
  form.append('file', new Blob([audio], { type }), `speech.${ext}`);
  const upstream = await fetch(`${API_BASE}/audio/transcriptions`, {
    method: 'POST', headers: auth(), body: form, signal: AbortSignal.timeout(60_000),
  });
  const data = await upstream.json().catch(() => ({}));
  res.writeHead(upstream.ok ? 200 : 502, { 'Content-Type': 'application/json' });
  if (!upstream.ok) console.error('STT error', upstream.status, JSON.stringify(data).slice(0, 500));
  res.end(JSON.stringify(upstream.ok ? { text: data.text || '' } : { error: "Couldn't hear that. Try again." }));
}

module.exports = { tts, transcribe };
