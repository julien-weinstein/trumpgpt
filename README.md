# TrumpGPT

A satirical chatbot that answers anything in Donald Trump's voice: the bragging, the grievances, the nicknames, the run-on tangents. It's labelled on the page as AI satire.

## How it works

- **Corpus** (`data/corpus.json.gz`, built by `scripts/build-corpus.js` with parsers in `lib/sources.js`) holds about 50,000 passages of his own words:
  - About 17,300 passages from 2015–16 rallies, interviews, debates and town halls ([Trump Campaign Corpus](https://github.com/unendin/Trump_Campaign_Corpus)). About 8,000 of them are paired with the question he was answering.
  - About 2,100 passages from 35 full 2019–20 rally speeches ([Trump_speech_NLP](https://github.com/davidtstill/Trump_speech_NLP)).
  - About 18,600 @realDonaldTrump tweets from 2009–2021 ([CompleteTrumpTweetsArchive](https://github.com/MarkHershey/CompleteTrumpTweetsArchive)).
  - About 12,600 Truth Social posts from February 2022 to the present ([truthsocial-archiver](https://github.com/mickpletcher/truthsocial-archiver)). Reposts, bare links and endorsement form letters are removed.
- **Live updates** (`lib/live.js`): every 6 hours the server pulls the newest Truth Social posts, so what he talks about stays current with no redeploy.
- **Retrieval** (`lib/corpus.js`): for every message, a BM25 search pulls his most relevant real quotes and posts on that topic, ranking recent material higher. It also adds random samples of his punchiest posts and his 15 latest posts, so he knows what's going on this week.
- **Persona** (`lib/persona.js`): the system prompt that sets the attitude of the second-term, post-indictment, post-Butler version of him: paranoid, aggrieved, vindictive and narcissistic. It includes a 2021–2025 timeline, picks a random reply shape (short and dismissive, rally ramble, Fox phone-in and so on) for variety, and bans AI tells like em dashes. It still requires a real answer inside the bluster. The guardrails are no slurs, no attacks on protected groups, no made-up crimes about real people, and no real threats.
- **Server** (`server.js`): plain Node with no dependencies. It streams replies from the OpenAI Responses API. The UI shows the real quotes each reply was styled on.

## Deploy on Render

- Build command: none, or `true`
- Start command: `node server.js`
- Environment variables:
  - `OPENAI_API_KEY` (required)
  - `OPENAI_MODEL` (default `gpt-4.1`; set it to your `ft:...` id after fine-tuning)
  - `TEMPERATURE` (optional; the default is 1.1 for gpt-4.x models and unset for others)
  - `RATE_LIMIT_PER_HOUR` (messages per IP, default 100)

## Optional: fine-tune a model on his words

```
OPENAI_API_KEY=sk-... node scripts/make-finetune.js --submit
```

This builds 3,000 examples, each pairing a real question he was asked with his real verbatim answer. It uploads them and starts an OpenAI fine-tuning job on `gpt-4.1-mini`. When the job finishes, set `OPENAI_MODEL` to the `ft:...` model id it gives you. Retrieval and the persona still apply on top. The job costs money on your OpenAI account; at the time of writing it's a few dollars at this size.

## Rebuild the corpus

```
node scripts/build-corpus.js            # downloads the sources from GitHub
node scripts/build-corpus.js ./sources  # or reads local clones of the four repos
```
