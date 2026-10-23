// Loads the corpus and serves BM25 retrieval over it, so each reply can be
// conditioned on the most relevant things Trump actually said or posted.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const STOP = new Set(('the a an and or but if then for to of in on at is are was were be been being it its this that ' +
  'these those you your me my we our they their them he she his her with from as by about what when how why do does ' +
  'did can could would should will have has had not no yes very just like so all out up there here get got going ' +
  'one know think say said people want really much many some more most well also than who which into over now ' +
  'make made way thing things lot right good great tell told look see okay because').split(' '));

const tokenize = s => (s.toLowerCase().match(/[a-z][a-z']{2,}/g) || [])
  .map(w => w.replace(/'s?$/, ''))
  .filter(w => w.length > 2 && !STOP.has(w));

const K1 = 1.2, B = 0.75;
const POSTS = new Set(['tweet', 'truth']);

// Newer material outranks older material on the same topic, so he talks
// about the present rather than 2016.
const recency = d => d >= '2025' ? 1.6 : d >= '2022' ? 1.4 : d >= '2019' ? 1.15 : 1;

function buildIndex(passages) {
  const postings = new Map(); // term -> [docIndex, tf, docIndex, tf, ...]
  const lengths = new Uint16Array(passages.length);
  let total = 0;
  passages.forEach((p, i) => {
    const tf = new Map();
    for (const w of tokenize((p.q || '') + ' ' + p.t)) tf.set(w, (tf.get(w) || 0) + 1);
    let len = 0;
    for (const [w, n] of tf) {
      len += n;
      let list = postings.get(w);
      if (!list) postings.set(w, list = []);
      list.push(i, n);
    }
    lengths[i] = Math.min(len, 65535);
    total += len;
  });
  // Typed arrays take a fraction of the memory of plain JS arrays.
  for (const [w, list] of postings) postings.set(w, Uint32Array.from(list));
  return { postings, lengths, avgLen: total / passages.length };
}

function load(file = path.join(__dirname, '..', 'data', 'corpus.json.gz')) {
  const passages = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  let index = buildIndex(passages);
  const self = { passages };

  // Returns the top `limit` passages that pass `filter`.
  self.search = (query, { limit = 5, filter = () => true } = {}) => {
    const { postings, lengths, avgLen } = index;
    const N = passages.length;
    const scores = new Map();
    for (const w of new Set(tokenize(query))) {
      const list = postings.get(w);
      if (!list) continue;
      const df = list.length / 2;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let j = 0; j < list.length; j += 2) {
        const i = list[j], tf = list[j + 1];
        const s = idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * lengths[i] / avgLen));
        scores.set(i, (scores.get(i) || 0) + s);
      }
    }
    return [...scores]
      .map(([i, s]) => [i, s * recency(passages[i].d)])
      .filter(([i]) => filter(passages[i]))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([i]) => passages[i]);
  };

  // Recomputes the derived pools; called after live additions.
  const refresh = () => {
    self.posts = passages.filter(p => POSTS.has(p.g));
    self.recentPosts = passages.filter(p => p.g === 'truth');
    self.spoken = passages.filter(p => !POSTS.has(p.g));
    self.latestDate = self.recentPosts.at(-1)?.d;
    self.stats = { spoken: self.spoken.length, posts: self.posts.length, latest: self.latestDate };
  };
  refresh();

  // Appends passages (assumed newer than everything loaded) and reindexes.
  self.add = more => {
    passages.push(...more);
    index = buildIndex(passages);
    refresh();
  };

  self.latest = n => self.recentPosts.slice(-n);
  self.sample = (list, n) => Array.from({ length: n }, () => list[Math.floor(Math.random() * list.length)]);
  return self;
}

module.exports = { load, tokenize, POSTS };
