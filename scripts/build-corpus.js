#!/usr/bin/env node
// Builds data/corpus.json.gz from public archives of Trump's own words:
//   - Trump Campaign Corpus (unendin): 2015–16 rallies, interviews, debates,
//     town halls and press conferences, with speakers labelled per turn.
//   - CompleteTrumpTweetsArchive (MarkHershey): @realDonaldTrump 2009–2021.
//
// Usage: node scripts/build-corpus.js [localSourceDir]
// With a local dir, files are read from <dir>/<repo-name>/<path> (shallow
// clones of the repos below); otherwise they are downloaded.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SOURCES = {
  campaign: ['unendin/Trump_Campaign_Corpus', 'trump_campaign_corpus.json'],
  tweetsBefore: ['MarkHershey/CompleteTrumpTweetsArchive', 'data/realDonaldTrump_bf_office.csv'],
  tweetsInOffice: ['MarkHershey/CompleteTrumpTweetsArchive', 'data/realDonaldTrump_in_office.csv'],
};
const SPOKEN = new Set(['speech', 'interview', 'town hall', 'press conference', 'debate']);
const TRUMP = 'Donald Trump';

async function load(key, localDir) {
  const [repo, file] = SOURCES[key];
  if (localDir) return fs.readFileSync(path.join(localDir, repo.split('/')[1], file), 'utf8');
  const url = `https://raw.githubusercontent.com/${repo}/master/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const clean = s => s
  .replace(/\[[^\]]{0,80}\]|\((?:applause|laughter|cheers|booing|crosstalk|inaudible)[^)]*\)/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Each doc is a list of turns {person, p}; p is a string, or an array of
// paragraphs and {note} stage directions.
function paragraphs(turn) {
  const p = Array.isArray(turn.p) ? turn.p : [turn.p];
  return p.filter(x => typeof x === 'string').map(clean).filter(Boolean);
}

function spokenPassages(docs) {
  const out = [];
  for (const d of docs) {
    if (!SPOKEN.has(d.genre)) continue;
    const turns = Array.isArray(d.doc) ? d.doc : [d.doc];
    const source = d.text_filename.replace(/\.txt$/, '');
    const date = new Date(d.date_published).toISOString().slice(0, 10);
    let lastQuestion = null;
    for (const turn of turns) {
      if (!turn || !turn.p) continue;
      const paras = paragraphs(turn);
      if (turn.person !== TRUMP) {
        const q = paras.join(' ');
        lastQuestion = q.length >= 15 && q.length <= 600 ? q : null;
        continue;
      }
      // Chunk Trump's turn into ~500–1200 char passages on paragraph breaks.
      let buf = '';
      const flush = () => {
        if (buf.length >= 160) {
          out.push({ g: d.genre, d: date, s: source, q: lastQuestion || undefined, t: buf });
          lastQuestion = null; // only the first chunk answers the question
        }
        buf = '';
      };
      for (const para of paras) {
        if (buf && buf.length + para.length > 1200) flush();
        buf += (buf ? '\n' : '') + para.slice(0, 1400);
      }
      flush();
    }
  }
  return out;
}

// The archive's CSVs were mac-roman mis-decoded once; undo the common cases.
const MOJIBAKE = { '‚Äô': '’', '‚Äò': '‘', '‚Ä¶': '…', '‚Äú': '“', '‚Äù': '”', '‚Äì': '–', '‚Äî': '—' };
const fixText = s => s.replace(/‚Ä[ô¶úùìîò]/g, m => MOJIBAKE[m] || m).replace(/&amp;/g, '&');

function tweetPassages(csv) {
  const out = [];
  for (const line of csv.split('\n').slice(1)) {
    const m = line.match(/^@realDonaldTrump, (\d{4}-\d\d-\d\d) [\d:]+, (\S+), "(.*)"\s*$/);
    if (!m) continue;
    const t = fixText(m[3].replace(/""/g, '"'))
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.startsWith('RT ') || /^['"]\s?@/.test(t) || t.length < 50) continue;
    out.push({ g: 'tweet', d: m[1], s: m[2], t });
  }
  return out;
}

async function main() {
  const localDir = process.argv[2];
  const docs = JSON.parse(await load('campaign', localDir));
  const spoken = spokenPassages(docs);
  const seen = new Set();
  const tweets = [
    ...tweetPassages(await load('tweetsBefore', localDir)),
    ...tweetPassages(await load('tweetsInOffice', localDir)),
  ].filter(x => !seen.has(x.t) && seen.add(x.t));

  const passages = [...spoken, ...tweets];
  const file = path.join(__dirname, '..', 'data', 'corpus.json.gz');
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(passages), { level: 9 }));
  console.log(`spoken passages: ${spoken.length} (${spoken.filter(x => x.q).length} with question)`);
  console.log(`tweets: ${tweets.length}`);
  console.log(`wrote ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
