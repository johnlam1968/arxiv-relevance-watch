# arxiv-relevance-watch

Finds the arXiv papers that matter to **one specific research topic**, ranks them, and keeps doing it
on a schedule. Built for a narrow subject — monodromy defects in quantum field theory — and meant to
be re-pointed at yours by editing two JSON files.

**No language model is called.** There is no summarisation, no chat, and no generated prose anywhere
in this tool. The only model involved is a *decision model*: it is handed a paper's title and
abstract and a fixed set of typed questions, and it returns a probability per question. Everything
else is deterministic code and the arXiv API.

What that buys you: **the same paper gets the same score every time, and you can read exactly why.**
What it costs you: the tool will not tell you what a paper says. It gives you links, numbers, and a
reason to click — that is all, and it is deliberate.

---

## Quick start

```bash
git clone https://github.com/johnlam1968/arxiv-relevance-watch
cd arxiv-relevance-watch

# 1. See what it finds, spending nothing and calling no model.
node src/cli.mjs --dry-run

# 2. Score the results. Needs a decision-service key.
export OPENROUTER_API_KEY=sk-or-...
node src/cli.mjs
```

Requires **Node 22.5 or newer** and has **no dependencies** — `npm install` is not needed.

Two environment variables matter:

| variable | default | notes |
|---|---|---|
| `OPENROUTER_API_KEY` | — | required to score. Also accepts `SYSTEMONE_API_KEY` / `TYPESAFE_API_KEY` |
| `ARXIV_USER_AGENT` | `arxiv-relevance-watch/1.0` | **set this.** arXiv asks every client to identify itself with a contact address: `ARXIV_USER_AGENT='arxiv-relevance-watch/1.0 (mailto:you@example.edu)'` |

`SYSTEMONE_BASE_URL` (default `https://openrouter.ai/api`) and `SYSTEMONE_MODEL` (default
`jev-latest`) point it at a different decision service — including a local one, in which case no API
key is needed.

---

## Pointing it at your subject

Everything about *what to look for* lives in **`config/topics-*.json`**. Copy it and edit:

```jsonc
{
  "name": "my subject",

  // What the judge is told your subject is. Used when you run without --text.
  "profile": "- defect conformal field theory in 3d\n- the Casimir energy of a line defect",

  "topics": [
    { "id": "my_topic",
      "label": "human-readable name",     // shows up in the report
      "patterns": ["how you write it", "another spelling"],   // lowercase; matched as substrings
      "query": "\"exact phrase for arXiv\"",                  // arXiv search syntax
      "weight": 10 }                       // specificity: rare+precise beats common
  ]
}
```

Three rules worth following:

* **Keep the profile narrow.** `"quantum field theory"` makes every hep-th paper relevant and the
  tool useless. Name the specific thing you are working on.
* **`patterns` are lowercase substrings.** Add the spellings you actually use, including British and
  American variants.
* **`weight` is a judgement, not a measurement.** A phrase that means your topic and nothing else
  deserves 10; a phrase with a large unrelated literature deserves 3, because it will drag in the
  other literature every time.

Then:

```bash
node src/cli.mjs --topics config/topics-my-subject.json --name my-subject
```

### Or point it at a document

If you have notes, a draft, or a grant application, let the tool work out which of your vocabulary
you actually use:

```bash
node src/cli.mjs --topics config/topics-my-subject.json --text ~/notes/my-notes.md
```

The lexicon is matched against your document and the topic profile is computed from the matches, so
a term you never write stops shaping the search.

---

## How a paper is scored

`config/questions-paper-relevance.json` holds the instrument — five typed questions asked about every
paper, alongside your topic profile. The reply to each is a probability, and the report shows them:

| question | type | what it answers |
|---|---|---|
| `paper_on_topic` | `noul` | is this about monodromy/twist defects or related line and conformal defects in QFT? |
| `paper_topic_overlap` | `score` (5 levels) | how much does its subject matter overlap your topic profile? |
| `paper_answers_open_problem` | `noul` | does it help with the specific open problems? |
| `paper_worth_reading` | `noul` | would someone working through these notes need it? |
| `paper_relation` | `choice` | background / advanced / different setting / unrelated word overlap / cannot tell |

A paper is reported when it clears **both** a rank threshold (from the `score` question) and an
on-topic gate (from the `noul`). Papers that clear the score but fail the gate are **listed
separately, never dropped** — that disagreement is usually the interesting part, and it is how the
false positives below were caught.

**Iterating the questions is the real work.** A working question and a confidently-wrong one look
identical until you test them against papers you have already read. See
[`docs/authoring-question-sets.md`](docs/authoring-question-sets.md) — it is written for whoever
maintains this instrument, and it is the part of this project most worth reading.

---

## Running it on a schedule

```bash
node src/cli.mjs --watch --max 20
```

`--watch` keeps a small SQLite file (`state/seen.sqlite`) and reports **only papers it has never
seen**. A nightly cron job:

```cron
0 7 * * * cd /path/to/arxiv-relevance-watch && \
  OPENROUTER_API_KEY=... ARXIV_USER_AGENT='... (mailto:you@example.edu)' \
  node src/cli.mjs --watch --max 20 >> watch.log 2>&1
```

Two things watch mode has to get right, both measured:

* **It sorts by submission date, not relevance.** A relevance-sorted query returns the same best
  papers every night, so a scheduled run would report "no news" forever while new papers piled up.
  Under `--watch` the query is bounded to `submittedDate:[<last run − 10 min> TO now]`.
* **It uses the precise `AND` queries, not the broad ones.** Date-sorting `all:"scaling function"`
  returned a turbulence paper, a Lévy-process paper and a kernel-methods paper — the phrase has
  several unrelated literatures and the newest members of all of them are recent. Relevance sorting
  hid that by ranking the good ones first; date sorting cannot.

Deleting `state/seen.sqlite` is safe: the next run simply reports everything as new.

---

## What it costs

Roughly **$0.001 per run** for 20–40 papers, on the default model. A nightly scan is well under a
dollar a year. `--dry-run` costs nothing and needs no key.

---

## Honest limitations

* **It does not read papers.** It sees the title, authors, date, categories and abstract. A paper
  that is relevant only in its section 4 will be missed.
* **A keyword query decides what is reachable at all.** If the right paper does not use your
  vocabulary, no amount of scoring will find it. Widen `patterns` if recall looks poor.
* **The scores are not calibrated probabilities.** A rank of 0.9 does not mean "90% likely to be
  useful to you". It is only meaningful *relative to other papers in the same run*, and it is meant
  for ordering, not for deciding.
* **The gate can be wrong in both directions.** It was tuned on one topic; check the
  "cleared the score but failed the on-topic gate" section of the report occasionally and adjust
  `--on-topic-threshold` if it is throwing away papers you wanted.
* **arXiv's API is rate-limited and asks for a contact address.** Set `ARXIV_USER_AGENT`.

## What was verified

13 unit tests cover the parsing and the reply-reading (`npm test`) — including the two bugs found
while building this: the reply's score field is named `level`, not `score`, and an entry's title must
not be confused with the feed's. The ranking itself was validated against a hand-labelled set of
papers on the topic this ships with; see
[`docs/worked-example.md`](docs/worked-example.md).

## Layout

```
src/cli.mjs          the command
src/arxiv.mjs        the arXiv API client
src/topics.mjs       lexicon -> topics -> queries
src/systemone.mjs    the decision-model client
src/state.mjs        the seen-state (SQLite)
src/vendor/          three small MIT files, vendored -- see PROVENANCE.md
config/              your topic and your question set: the two files you edit
docs/                how to author question sets, and a worked example
```

## License

MIT. `src/vendor/` carries three files from another MIT project with attribution — see
[`src/vendor/PROVENANCE.md`](src/vendor/PROVENANCE.md).
