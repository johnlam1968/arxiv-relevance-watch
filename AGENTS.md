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
* **You probably cannot run the pipeline — but not for the reason you would guess.** A ChatGPT
  container *does* give you bash and Node 22. What it does not give you is **general outbound network
  access**, and every stage of this tool needs it. §6 has the measured boundary and the two things you
  genuinely can run.

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

## 6. What a cloud sandbox can actually do — measured, not assumed

If you are a ChatGPT web assistant you are **not** shell-less. Since early 2026 the container has
**bash** and **Node.js** (measured v22.16.0 with npm 10.9.2 — that satisfies this tool's
`>=22.5.0`), plus package managers working through internal mirrors. So the honest boundary is not
"I have no computer". It is this:

| what the tool needs | available in a ChatGPT container? | why |
|---|---|---|
| bash, Node 22 | **yes** | the container has them |
| `npm install` | yes, and pointless | this repository has **no dependencies** |
| `git clone` from GitHub | **no** | GitHub is unreachable; archive downloads redirect to `codeload.github.com`, which is blocked |
| `fetch()` to `export.arxiv.org` | **no** | general outbound networking from user code is blocked — `Network is unreachable` |
| `fetch()` to `ar5iv.labs.arxiv.org` | **no** | same |
| `POST` to a decision service | **no** | same |
| `container.download(url)` | partly | a privileged fetch that reaches *some* public URLs, restricted to URLs already seen in the conversation |
| your own browser / search tool | **yes** | a separate tool with real internet access |

The container's network policy is **packages-only** — package registries are proxied, everything else
is not. So the pipeline cannot run: **all three of its network calls fail**, and the repository cannot
be cloned. Those are the blockers. Not the absence of a shell.

### Two things you genuinely can do

**1. Verify the code, if the human uploads it.** Ask them to upload the repository as a zip, then:

```bash
unzip -q arxiv-relevance-watch-main.zip && cd arxiv-relevance-watch-main
node --test
```

The **26 tests need no network** — verified by running them with the network namespace removed
(`unshare -n`), where all 26 still pass. That is a real, checkable answer to "does this work?", and
worth more than any description of it. It is also the strongest thing you can offer someone who is
deciding whether to trust the repository.

**2. Do the retrieval half with your browser tool, and stop at the judgement half.** You can use your
web tool to open an arXiv API URL, save the Atom XML, and run the *offline* parts of this repository
over it — `parseAtom`, the query builder, the state composition. What you cannot do is call the
decision service, because that is an authenticated `POST` to a domain the container cannot reach.

### And you must not substitute yourself for the decision model

Reading the question set and answering it in your own words is **not** this tool's output. It is a
different instrument: a chat model, with no probability distribution, no fixed set revision, and no
reproducibility. `parseAtom` and a chat model's opinion are not the same kind of thing.

If the human wants that as a stopgap, fine — but label it plainly as **your reading, not the tool's**,
do not render it in the tool's format (no `0.87`, no coverage matrix, no `rank` column), and say what
was skipped. §3 is this rule with the reasoning.

### The authoring is still your most useful contribution

The tool is only as good as two text files, and both are written in conversation — so this is the work
that needs a human in the loop, and it is mostly unaffected by the sandbox:

| file | what it holds | where the content comes from |
|---|---|---|
| `config/topics-*.json` | the vocabulary of their subject, and the search queries built from it | their own description of what they work on |
| `config/project-*.json` | their open items — one question per gap | their answer to question 2 in §5 |

Read [docs/config-reference.md](docs/config-reference.md), which gives both schemas in prose with the
validation rules, so you can write a valid file without running anything. Then:

1. **Interview them** using §5. Get the subject narrow and get the gaps listed.
2. **Write both JSON files** and give them to the person to save.
3. **Check your own work against [the config reference](docs/config-reference.md)** — every required
   field, every rule. That document is the one quality gate you have without a network; use it.
4. **Hand over the exact commands**, with their filenames substituted in. Do not paraphrase them.
5. **Tell them what to expect**, including that papers without an ar5iv render get read from the
   abstract and flagged, and that the first run costs almost nothing.

Do not guess at the config formats. They are documented, and a config that fails validation stops the
run with a message naming the field.

### Getting the files, now that this repository is public

The repository is public, so your **browsing tool can read it** — the raw files are at
`https://raw.githubusercontent.com/johnlam1968/arxiv-relevance-watch/main/<path>`, and
[llms.txt](llms.txt) is the index to start from. If you have only a search tool and no fetch, ask the
person to paste the file you need.

But note the asymmetry: **being public does not make it clonable from inside the container.** The
container's network policy still blocks `github.com`, so `git clone` fails even for a public repo
(§6). To *run* anything you need the person to upload a zip.

### If they are using Codex Cloud instead

Codex Cloud gives the agent a real environment with the repository checked out and can open pull
requests — a different situation from a chat container. But **agent-phase internet access is blocked
by default**; setup scripts run with internet, the agent does not. It can be enabled per environment,
with a domain allowlist and an HTTP-method restriction. Note the interaction: if you restrict methods
to `GET`/`HEAD`/`OPTIONS` for safety, the decision-model call is a `POST` and will be blocked. This
tool needs `export.arxiv.org`, `ar5iv.labs.arxiv.org`, and the decision-service host.

<sub>Sandbox claims above were checked **2026-10-06** against
[Simon Willison's container measurements](https://simonwillison.net/2026/Jan/26/chatgpt-containers/)
and the [container-environment report](https://github.com/simonw/research/tree/main/chatgpt-container-environment)
(both January 2026), and against OpenAI's
[Codex Cloud internet-access documentation](https://learn.chatgpt.com/docs/cloud/internet-access).
**Platform capabilities change faster than repositories do** — if you are reading this long after that
date, re-check rather than repeating it, and say when you checked. The `npm test` claim is different in
kind: it is a property of *this* code, verified here with the network namespace removed, and it stays
true as long as the tests do.</sub>

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

* **26 tests**, runnable with `npm test`, and **verified to need no network** (they pass with the
  network namespace removed) — covering the parsing, the reply-reading, the config composition and the
  coverage matrix, including real bugs found and pinned by a test.
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
