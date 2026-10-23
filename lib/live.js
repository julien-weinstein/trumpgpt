// Keeps the corpus current: every few hours, fetch the tail of the
// truthsocial-archiver dataset (new posts are appended to the end) and add
// anything newer than what we already have.
const { truthPassage } = require('./sources');

const URL = 'https://raw.githubusercontent.com/mickpletcher/truthsocial-archiver/main/docs/data/posts.jsonl';
const TAIL_BYTES = 4_000_000; // roughly the last couple of months of posts
const EVERY = 6 * 3600e3;

async function update(corpus) {
  const res = await fetch(URL, { headers: { Range: `bytes=-${TAIL_BYTES}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw Error(`HTTP ${res.status}`);
  const lines = (await res.text()).split('\n').slice(1); // first line is partial
  const known = new Set(corpus.recentPosts.slice(-3000).map(p => p.id).filter(Boolean));
  const knownText = new Set(corpus.recentPosts.slice(-3000).map(p => p.t));
  const fresh = [];
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const p = truthPassage(row);
    if (p && p.d >= corpus.latestDate && !known.has(p.id) && !knownText.has(p.t)) {
      fresh.push(p);
      knownText.add(p.t);
    }
  }
  if (fresh.length) corpus.add(fresh.sort((a, b) => a.d.localeCompare(b.d)));
  console.log(`Live update: +${fresh.length} Truth Social posts (latest ${corpus.latestDate})`);
}

function startLiveUpdates(corpus) {
  const run = () => update(corpus).catch(e => console.warn('Live update failed:', e.message));
  setTimeout(run, 5_000);
  setInterval(run, EVERY).unref();
}

module.exports = { startLiveUpdates };
