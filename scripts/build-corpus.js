#!/usr/bin/env node
// Builds data/corpus.json.gz from public archives of Trump's own words:
//   - Trump Campaign Corpus (unendin): 2015–16 rallies, interviews, debates,
//     town halls and press conferences, with speakers labelled per turn.
//   - Trump_speech_NLP (davidtstill): 35 full rally speeches, 2019–20.
//   - CompleteTrumpTweetsArchive (MarkHershey): @realDonaldTrump 2009–2021.
//   - truthsocial-archiver (mickpletcher): Truth Social posts, 2022–present.
//     The server also tops this up live (see lib/live.js).
//
// Usage: node scripts/build-corpus.js [localSourceDir]
// With a local dir, files are read from <dir>/<repo-name>/<path> (shallow
// clones of the repos below); otherwise they are downloaded.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const src = require('../lib/sources');

const REPOS = {
  campaign: 'unendin/Trump_Campaign_Corpus',
  rallies: 'davidtstill/Trump_speech_NLP',
  tweets: 'MarkHershey/CompleteTrumpTweetsArchive',
  truth: 'mickpletcher/truthsocial-archiver',
};

function reader(localDir) {
  const read = async (repo, file, branch = 'master') => {
    if (localDir) return fs.readFileSync(path.join(localDir, repo.split('/')[1], file), 'utf8');
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw Error(`${url}: HTTP ${res.status}`);
    return res.text();
  };
  const list = async (repo, dir) => {
    if (localDir) return fs.readdirSync(path.join(localDir, repo.split('/')[1], dir));
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${dir}`);
    if (!res.ok) throw Error(`listing ${repo}/${dir}: HTTP ${res.status}`);
    return (await res.json()).map(f => f.name);
  };
  return { read, list };
}

async function main() {
  const { read, list } = reader(process.argv[2]);

  const campaign = src.campaignPassages(JSON.parse(await read(REPOS.campaign, 'trump_campaign_corpus.json')));

  const rallies = [];
  for (const name of (await list(REPOS.rallies, 'speeches')).filter(n => n.endsWith('.txt'))) {
    rallies.push(...src.rallyPassages(name, await read(REPOS.rallies, `speeches/${name}`)));
  }

  // Pre-2015 tweets are mostly Apprentice promos and business quotes; keep
  // only the combative ones to save memory.
  const seen = new Set();
  const tweets = [
    ...src.tweetPassages(await read(REPOS.tweets, 'data/realDonaldTrump_bf_office.csv')),
    ...src.tweetPassages(await read(REPOS.tweets, 'data/realDonaldTrump_in_office.csv')),
  ].filter(x => !seen.has(x.t) && seen.add(x.t))
    .filter(x => x.d >= '2015' || /!/.test(x.t) && /\b(Obama|loser|dumb|fool|fake|weak|sad|incompetent)\b/i.test(x.t));

  const truths = src.truthPassages(await read(REPOS.truth, 'docs/data/posts.jsonl', 'main'))
    .filter(x => !seen.has(x.t) && seen.add(x.t))
    .sort((a, b) => a.d.localeCompare(b.d));

  const passages = [...campaign, ...rallies, ...tweets, ...truths];
  const file = path.join(__dirname, '..', 'data', 'corpus.json.gz');
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(passages), { level: 9 }));
  console.log(`2015–16 transcripts: ${campaign.length} (${campaign.filter(x => x.q).length} with question)`);
  console.log(`2019–20 rallies: ${rallies.length}`);
  console.log(`tweets 2009–21: ${tweets.length}`);
  console.log(`truth social: ${truths.length} (${truths[0].d} to ${truths.at(-1).d})`);
  console.log(`wrote ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
