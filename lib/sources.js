// Parsers that turn each public archive into corpus passages:
//   { g: genre, d: 'YYYY-MM-DD', s: source, q?: question asked, t: text }
// Shared by scripts/build-corpus.js and the live Truth Social updater.

const SPOKEN = new Set(['speech', 'interview', 'town hall', 'press conference', 'debate']);
const TRUMP = 'Donald Trump';

const squash = s => s.replace(/\s+/g, ' ').trim();
const clean = s => squash(s
  .replace(/\[[^\]]{0,80}\]|\((?:applause|laughter|cheers|booing|crosstalk|inaudible)[^)]*\)/gi, ' '));

// Splits text into ~500–1200 char chunks on paragraph or sentence boundaries.
function chunk(pieces, max = 1200) {
  const out = [];
  let buf = '';
  for (const piece of pieces) {
    if (buf && buf.length + piece.length > max) { out.push(buf); buf = ''; }
    buf += (buf ? '\n' : '') + piece.slice(0, 1400);
  }
  if (buf) out.push(buf);
  return out.filter(c => c.length >= 160);
}

// Trump Campaign Corpus: docs are lists of turns {person, p}, where p is a
// string, or an array of paragraphs and {note} stage directions.
function campaignPassages(docs) {
  const out = [];
  for (const d of docs) {
    if (!SPOKEN.has(d.genre)) continue;
    const turns = Array.isArray(d.doc) ? d.doc : [d.doc];
    const source = d.text_filename.replace(/\.txt$/, '');
    const date = new Date(d.date_published).toISOString().slice(0, 10);
    let lastQuestion = null;
    for (const turn of turns) {
      if (!turn || !turn.p) continue;
      const paras = (Array.isArray(turn.p) ? turn.p : [turn.p])
        .filter(x => typeof x === 'string').map(clean).filter(Boolean);
      if (turn.person !== TRUMP) {
        const q = paras.join(' ');
        lastQuestion = q.length >= 15 && q.length <= 600 ? q : null;
        continue;
      }
      for (const t of chunk(paras)) {
        out.push({ g: d.genre, d: date, s: source, q: lastQuestion || undefined, t });
        lastQuestion = null; // only the first chunk answers the question
      }
    }
  }
  return out;
}

// 2019–20 rally transcripts: one file per rally, named like TulsaJun20_2020.
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function rallyPassages(name, text) {
  const m = name.match(/^(.*?)([A-Z][a-z]{2})(\d{1,2})_(\d{4})/);
  const date = m ? `${m[4]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[3].padStart(2, '0')}` : '2020-01-01';
  const place = m ? m[1].replace(/([a-z])([A-Z])/g, '$1 $2') : name;
  const sentences = clean(text).match(/[^.!?]+[.!?]+["”]?\s*/g) || [];
  return chunk(sentences.map(s => s.trim()), 1000)
    .map(t => ({ g: 'rally', d: date, s: `Rally, ${place}`, t: t.replace(/\n/g, ' ') }));
}

// The Twitter archive's CSVs were mac-roman mis-decoded once; undo that.
const MOJIBAKE = { '‚Äô': '’', '‚Äò': '‘', '‚Ä¶': '…', '‚Äú': '“', '‚Äù': '”', '‚Äì': '–', '‚Äî': '—' };
const fixText = s => s.replace(/‚Ä[ô¶úùìîò]/g, m => MOJIBAKE[m] || m).replace(/&amp;/g, '&');

function tweetPassages(csv) {
  const out = [];
  for (const line of csv.split('\n').slice(1)) {
    const m = line.match(/^@realDonaldTrump, (\d{4}-\d\d-\d\d) [\d:]+, (\S+), "(.*)"\s*$/);
    if (!m) continue;
    const t = squash(fixText(m[3].replace(/""/g, '"')).replace(/https?:\/\/\S+/g, ''));
    if (t.startsWith('RT ') || /^['"]\s?@/.test(t) || t.length < 50) continue;
    out.push({ g: 'tweet', d: m[1], s: m[2], t });
  }
  return out;
}

// Truth Social archive rows (one JSON object per line). Returns null for
// reposts, bare links and image-only posts.
function truthPassage(row) {
  const t = squash((row.text || '').replace(/https?:\/\/\S+/g, ''));
  if (t.length < 40 || /^RT\b/.test(t) || row.reblog) return null;
  // Endorsement form letters and nomination announcements carry no voice.
  if (/Complete and Total Endorsement|GET OUT AND VOTE FOR|I am pleased to (nominate|announce)/i.test(t)) return null;
  return { g: 'truth', d: row.created_at.slice(0, 10), s: row.url, id: row.id, t: t.slice(0, 1500) };
}

function truthPassages(jsonl) {
  const out = [];
  for (const line of jsonl.split('\n')) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const p = truthPassage(row);
    if (p) out.push(p);
  }
  return out;
}

module.exports = { campaignPassages, rallyPassages, tweetPassages, truthPassages, truthPassage };
