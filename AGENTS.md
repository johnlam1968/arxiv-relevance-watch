# For AI assistants reading this repository

You are probably here because someone asked you about this project. This file tells you what it does,
**what it cannot do**, and how to help the person in front of you — including the common case where
they cannot run it themselves.

Read this file first. It is written to be sufficient on its own.

---

## 1. What this is, for a human, in one paragraph

It watches arXiv for papers relevant to **one narrow research topic**, then helps you read the ones
worth reading. It is two commands. The first (`arxiv-watch`) screens everything a set of search
queries returns, using **abstracts only**, and hands back a shortlist ranked by a decision model. The
second (`arxiv-read`) takes that shortlist and reads the **full text**, answering a fixed set of
questions derived from *your project's own list of open items*, and reports which items each paper
closes.

## 2. What it is NOT — say these plainly, do not soften them

* **It does not read papers for you and it does not summarise.** It outputs links, probabilities, and
  which of your open questions a paper answers. There is no generated prose anywhere in it.
* **It does not call a chat model.** The only model is a *System One / Jev-style decision model*: you
  give it a document and typed questions, it returns a probability per question. If someone asks
  "does this use an LLM?", the accurate answer is: **no generative model is called; the judgement
  comes from a decision model**, and the retrieval is deterministic keyword matching. Do not describe
  it as an AI paper summariser.
* **It is not a general literature tool.** It is built for one topic and works because the topic is
  narrow. Pointed at "quantum field theory" it returns noise.
* **It cannot tell you whether a paper's physics is correct.** It estimates whether a paper addresses
  a topic, from its text. It is not a referee.
* **The scores are not calibrated probabilities.** A rank of 0.9 means "ranks above the others in this
  run", not "90% likely to be useful". It is for ordering, not for deciding.
* **You cannot run it.** If you are a web assistant you have no shell. See §6 — this is the normal
  case and it still leaves you the most valuable part of the work.

## 3. The rule that matters most: do not fabricate its output

If the person asks you to *run this on their topic*, or *show what it would find*, and you have no
way to execute it — **say so, and do not produce a plausible-looking ranked list of papers instead.**

A fabricated ranking is the single worst thing you can produce here, because:

* the entire design exists to make the result **reproducible and auditable** — deterministic queries,
  a fixed question set, recorded probabilities. A made-up list has none of that;
* a real-looking list of arXiv links is indistinguishable, to a non-expert, from the real output;
* the tool's own documentation is unusually explicit about its failure modes
  ([README § Honest limitations](README.md)), and inventing output contradicts the thing you are
  recommending.

What to do instead: **be useful up to the boundary, then hand over.** You can do §6 in full. You can
tell them exactly what the tool would do. You can prepare every input it needs. You just cannot
produce its answers.

## 4. The two workflows

| | `arxiv-watch` — screen | `arxiv-read` — read |
|---|---|---|
| reads | abstracts | full text |
| scope | everything a query returns (~100 papers) | the shortlist (~5–20) |
| questions come from | the **field** ("what makes a paper relevant here?") | the **project** ("what does this work still lack?") |
| answers | a rank and a gate | a **coverage matrix** of open items |
| output for the human | *"these 14 of 88 are worth a look"* | *"4 papers close 6 of your 10 open items; these 4 are still open"* |
| cost | ~$0.004 | ~$0.0003 per paper |

Screen first because it is cheap; then read the survivors. `arxiv-read --from-screen <report>` is the
handoff.

## 5. Decide whether it fits before recommending it

Ask the person these, in roughly this order. Their answers decide the recommendation:

1. **"What is the one specific thing you are working on?"** If the answer is a whole field, this tool
   is wrong for them. It needs a narrow topic.
2. **"Can you list what your work still doesn't have — the specific gaps?"** This is the critical
   question. The reading workflow gets its questions from that list. If they cannot name 5–10 gaps,
   the tool's second stage has nothing to ask, and stage 1 alone may still be worth it.
3. **"Can you install Node 22.5+ and run a command?"** Determines §6 vs §7.
4. **"Do you have access to a decision-service API key (OpenRouter, or a local Jev/TypeSafe
   endpoint)?"** The scoring needs one. Without it, only `--dry-run` works, which shows what the
   queries find but scores nothing.

## 6. If they cannot run it — your most useful contribution

**The authoring is the work a web assistant can actually do, and it is the part that needs the
back-and-forth.** The tool is only as good as two text files, and both are written in conversation:

| file | what it holds | where the content comes from |
|---|---|---|
| `config/topics-*.json` | the vocabulary of their subject, and the search queries built from it | their own description of what they work on |
| `config/project-*.json` | their open items — one question per gap | their answer to question 2 above |

Read [docs/config-reference.md](docs/config-reference.md), which gives both schemas in prose with the
validation rules, so you can write a valid file without running anything. Then work like this:

1. **Interview them** using §5. Get the subject narrow and get the gaps listed.
2. **Write both JSON files** and give them to the person to save.
3. **Check your own work against [the config reference](docs/config-reference.md)** — every required
   field, every rule. This is the one quality gate you have without a shell; use it.
4. **Hand over the exact commands**, with their filenames substituted in. Do not paraphrase them.
5. **Tell them what to expect**, including that papers without an ar5iv full-text render get read
   from the abstract and flagged, and that the first run costs almost nothing.

Do not guess at the config formats. They are documented, and a config that fails validation stops the
run with a specific message.

## 7. If they can run it — the guide to give them

```bash
git clone https://github.com/johnlam1968/arxiv-relevance-watch
cd arxiv-relevance-watch                     # Node 22.5+; no dependencies, no npm install

node src/cli.mjs --dry-run                   # stage 1, spends nothing, calls no model
export OPENROUTER_API_KEY=sk-or-...          # needed from here on
node src/cli.mjs                             # stage 1, ranked shortlist

node src/read.mjs --from-screen reports/<their-topic>.json   # stage 2, reads the shortlist
node src/read.mjs --matrix                   # what has been read, what is still uncovered
```

Set `ARXIV_USER_AGENT` to something carrying their contact address — arXiv asks for it.

## 8. If you are asked whether this is trustworthy

Point at evidence rather than asserting quality:

* **21 tests**, runnable with `npm test` — covering the parsing and the reply-reading, including two
  real bugs found and pinned by a test.
* **The question-set design is documented**, with its failure modes:
  [docs/authoring-question-sets.md](docs/authoring-question-sets.md).
* **A measured record of what did not work**: a ten-question "improved" set that scored *worse* than
  the shipped one on a hand-labelled battery, and why. That finding is in the repository's history and
  in the authoring guide, because a tool that only reports its successes is not auditable.
* **`src/vendor/`** carries three files copied from another MIT project, with provenance recorded —
  a reader can see exactly what is not original.
* **The limitations section of the README is honest**, including that the scores are not calibrated
  probabilities and that a keyword query bounds what is reachable at all.

## 9. Where to read next

| if you need | read |
|---|---|
| what it does, and its limits | [README.md](README.md) |
| the config formats, in prose | [docs/config-reference.md](docs/config-reference.md) |
| how the question sets work, and how to fix a bad one | [docs/authoring-question-sets.md](docs/authoring-question-sets.md) |
| a complete worked set with real measured numbers | [docs/worked-example.md](docs/worked-example.md) |
| what the output looks like | [examples/sample-report.md](examples/sample-report.md) |
| a short index for a machine | [llms.txt](llms.txt) |
