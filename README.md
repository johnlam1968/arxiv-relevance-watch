# arxiv-relevance-watch

Finds the arXiv papers that matter to **one specific research topic**, ranks them, and then helps you
**read** them. Built for a narrow subject — monodromy defects in quantum field theory — and meant to
be re-pointed at yours by editing three JSON files.

**No language model is called.** There is no summarisation, no chat, and no generated prose anywhere
in this tool. The only model involved is a *decision model*: it is handed a document and a fixed set
of typed questions, and it returns a probability per question. Everything else is deterministic code
and the arXiv API.

What that buys you: **the same paper gets the same score every time, and you can read exactly why.**
What it costs you: the tool will not tell you what a paper says. It gives you links, numbers, and a
reason to click — that is all, and it is deliberate.

---

## Asking an AI assistant about this repo?

Most people meet this project by pasting it into ChatGPT or Claude. That works, with one caveat worth
stating precisely, because the obvious guess is wrong: a ChatGPT container **does** have bash and
Node.js. What it does not have is **general outbound network access** — so none of this tool's three
network calls can be made from it, and the repository cannot be cloned there either. What an assistant
*can* do is read the repo, write your config files, and — if you upload the source as a zip — run the
test suite, which needs no network at all.

Paste this, filling in the blanks:

```
Read https://github.com/johnlam1968/arxiv-relevance-watch — start with AGENTS.md,
then docs/config-reference.md.

My topic is: <one sentence, as narrow as you can make it>
What my work still doesn't have: <5–10 specific gaps>

Then tell me:
  1. whether this tool actually fits my situation, and if not, what would,
  2. the two config files you would write for me, checked against the reference,
  3. the exact commands I would run,
  4. and what you cannot do for me.
```

Question 4 is the important one. A general assistant asked to "run this on my topic" will be tempted
to produce a plausible-looking ranked list of papers instead — which is exactly the output this tool
exists to make *reproducible*, and the one thing a plausible fabrication can imitate perfectly. The
same goes for answering the question set in its own words: that is a chat model's reading, not this
tool's output, and it should be labelled as such. The repository tells assistants both of these in
[`AGENTS.md`](AGENTS.md) §3 and §6.

**If you are an AI assistant**, read [`AGENTS.md`](AGENTS.md) — it covers what this does, what it
cannot do, how to decide whether it fits, and how to help someone who cannot run it. A short machine
index is at [`llms.txt`](llms.txt); local harnesses can start from [`CLAUDE.md`](CLAUDE.md).

---

## The two workflows

They answer different questions, read different things, and get their questions from different places.

| | **`arxiv-watch`** — screen | **`arxiv-read`** — read |
|---|---|---|
| subject | every paper a query returns | the shortlist |
| reads | the **abstract** | the **full text** |
| questions come from | the **field** — what makes a paper relevant here? | **your project** — what does this work still lack? |
| answers | a rank and a gate | a **coverage matrix**: which of your open items each paper closes |
| output | *"these 14 of 88 are worth a look"* | *"these 4 papers close 6 of your 10 open items; these 4 are still open"* |
| cost | ~$0.004 for 88 papers | ~$0.0003 per paper |

Screen first because it is cheap and reading is not; then read the survivors. The handoff is one flag:

```bash
arxiv-watch --watch --max 20                    # screen
arxiv-read --from-screen reports/my-topic.json  # read everything it selected
```

## Quick start

```bash
git clone https://github.com/johnlam1968/arxiv-relevance-watch
cd arxiv-relevance-watch

# STAGE 1 — screen. See what the queries find, spending nothing and calling no model.
node src/cli.mjs --dry-run

# STAGE 1 — score the results. Needs a decision-service key.
export OPENROUTER_API_KEY=sk-or-...
node src/cli.mjs

# STAGE 2 — read the ones that survived, against your project's open items.
node src/read.mjs --from-screen reports/monodromy-defects-in-quantum-field-theory.json

# STAGE 2 — what has been read so far, and what is still uncovered. No model needed.
node src/read.mjs --matrix
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

## Reading a paper in depth

`config/project-*.json` is the axis source for stage 2, and it is the file you edit most:

```jsonc
{
  "name": "monodromy defects in quantum field theory",
  "revision": "open-items@1",          // bump this when the list below changes

  // Prose. Goes into the judged state verbatim. Write it for someone who has not read your notes,
  // and keep it narrow.
  "context": "Working notes on ... Setting: a free massless complex scalar field in 3 dimensions ...",

  // EACH ITEM IS BOTH ONE QUESTION AND ONE COLUMN OF THE MATRIX.
  "open_items": [
    { "id": "covers_flat_space_per_unit_length",
      "label": "flat-space energy per unit length",
      "question": "Does PAPER give the Casimir energy of a line defect in FLAT space as an energy per unit length along the defect?" }
  ],

  // Everything that is not a coverage question: provenance, calibration controls, an overall score.
  "questions": [ /* ... */ ]
}
```

Three things follow from putting the open items in a file:

**The matrix is the output, not a single number.** One paper is one row. What you act on is which
columns are still empty:

```
open item                           best  best paper
an explicit defect free energy      0.91  2104.09419
the d=3 case                        0.94  2104.09419
flat-space energy per unit length   0.11  2104.09419   <- still open
the cusp                            0.54  2108.05107
defect operator dimensions          0.92  1310.5078
gauge vs background field           0.19  2108.05107   <- still open
backreaction                        0.15  1310.5078   <- still open

6/10 open item(s) addressed by at least one paper
```

**Your next search is written by the empty columns.** Four papers in, `gauge vs background field` is
still at 0.19 across all of them — that is a fact about the literature relative to your project, and
it tells you what to go looking for.

**The set evolves, and revisioning keeps it honest.** When a paper closes an item, delete the item
from `open_items` and bump `revision`. Reads are recorded per revision, so a paper read against
`@1` and again against `@2` is not mistaken for a duplicate — it answered *different questions*, and
collapsing the two would mix two instruments into one table.

### Full text, and why a degraded read is reported

Stage 2 fetches the **full text** from [ar5iv](https://ar5iv.labs.arxiv.org) (arXiv's HTML render).
Not every paper has one. When it is missing, the read falls back to the abstract — and **says so**,
because judging a paper's coverage from an abstract asks a document to answer questions it mostly
does not address, and a confident low probability would then read as a finding about the paper when
it is a fact about the fetch. Use `--require-fulltext` to skip those papers entirely rather than
degrade them. In a test run, 2 of 5 papers had no ar5iv render.

ar5iv's mathematics is partly garbled by the HTML conversion, and the built state says so, so the
judge knows not to answer a question that turns on an equation.

### The handoff

`--from-screen <report.json>` takes exactly the papers that cleared **both** gates in a screening
report. That is the whole pipeline: screen everything, read the survivors.

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
src/cli.mjs          arxiv-watch — STAGE 1, screen abstracts
src/read.mjs         arxiv-read  — STAGE 2, read full texts against the project's open items
src/topics.mjs       lexicon -> topics -> queries
src/project.mjs      the project spec -> the depth question set -> the coverage matrix
src/arxiv.mjs        the arXiv API client
src/fulltext.mjs     ar5iv full text, with a loud degraded fallback to the abstract
src/systemone.mjs    the decision-model client
src/state.mjs        the screening seen-state (SQLite)
src/read-state.mjs   the reading matrix, keyed by paper AND set revision (SQLite)
src/vendor/          three small MIT files, vendored -- see PROVENANCE.md
config/              topics (stage 1) · questions (stage 1) · project + open items (stage 2)
docs/                how to author question sets, and a worked example
```

## License

MIT. `src/vendor/` carries three files from another MIT project with attribution — see
[`src/vendor/PROVENANCE.md`](src/vendor/PROVENANCE.md).
