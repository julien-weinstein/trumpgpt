# TrumpGPT

A satirical chatbot that answers anything in Donald Trump's voice: the bragging, the grievances, the nicknames, the run-on tangents. It's clearly labelled as an unofficial parody.

## How it works

- **Corpus** (`data/corpus.json.gz`, built by `scripts/build-corpus.js`) holds about 46,700 passages of his own words:
  - About 17,300 spoken passages from 2015–16 rallies, interviews, debates, town halls and press conferences ([Trump Campaign Corpus](https://github.com/unendin/Trump_Campaign_Corpus)). Only his turns are kept, and about 8,000 of them are paired with the question he was answering.
  - About 29,400 original @realDonaldTrump posts from 2009–2021 ([CompleteTrumpTweetsArchive](https://github.com/MarkHershey/CompleteTrumpTweetsArchive)), with retweets removed.
- **Retrieval** (`lib/corpus.js`): for every message, a BM25 search pulls his most relevant real quotes and posts on that topic, plus random samples of his punchiest posts. These go into the prompt as style references.
- **Persona** (`lib/persona.js`): the system prompt that sets the attitude, which is narcissistic, derisive, aggrieved and bullying. It still requires a real answer inside the bluster. The guardrails are no slurs, no attacks on protected groups, no made-up crimes about real people, and no real threats.
- **Server** (`server.js`): plain Node with no dependencies. It streams replies from the OpenAI Responses API. The UI shows the real quotes each reply was styled on.

## Deploy on Render

- Build command: none, or `true`
- Start command: `node server.js`
- Environment variables:
  - `OPENAI_API_KEY` (required)
  - `OPENAI_MODEL` (default `gpt-4.1`; set it to your `ft:...` id after fine-tuning)
  - `TEMPERATURE` (optional, e.g. `1.0`; leave it unset for reasoning models)
  - `RATE_LIMIT_PER_HOUR` (messages per IP, default 60)

## Optional: fine-tune a model on his words

```
OPENAI_API_KEY=sk-... node scripts/make-finetune.js --submit
```

This builds 3,000 examples, each pairing a real question he was asked with his real verbatim answer. It uploads them and starts an OpenAI fine-tuning job on `gpt-4.1-mini`. When the job finishes, set `OPENAI_MODEL` to the `ft:...` model id it gives you. Retrieval and the persona still apply on top. The job costs money on your OpenAI account; at the time of writing it's a few dollars at this size.

## Rebuild the corpus

```
node scripts/build-corpus.js            # downloads the sources from GitHub
node scripts/build-corpus.js ./sources  # or reads local clones of the two repos
```
