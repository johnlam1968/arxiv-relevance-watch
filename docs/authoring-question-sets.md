# Authoring question sets

*For whoever maintains the instruments in `config/questions-*.json` (screening) and
`config/project-*.json` (reading). You do not need to read any code to write a valid set.*

A **question set** is several typed questions asked together about one subject, whose answers are
probabilities. It is an **instrument**: you build it to measure something specific about a stream of
subjects, and you keep it because it keeps working. This skill is about writing one, and about
iterating it with the person who knows the domain.

It is deliberately self-contained. You do not need any codebase to write a valid set.

## The one thing to understand first

The model does not know your intent. It returns **a probability distribution over the options you
offered**, and it will do so with high confidence even when it has effectively ignored the question.
A question that looks reasonable, reads well, and returns a clean number can be measuring nothing, or
measuring the opposite of what you meant.

**So a question is not accepted because it runs. It is accepted because it separated subjects whose
answer you already knew.** Every check in this document exists to serve that one sentence.

## The document format, completely

A set is a JSON array of question specs. Every spec has `id`, `type` and `instructions`; `type`
decides the rest.

```json
[
  { "id": "on_topic", "type": "noul",
    "instructions": "Is PAPER about monodromy (twist) defects in quantum field theory?" },

  { "id": "overlap", "type": "score",
    "instructions": "How much of PAPER's subject matter overlaps the CONVERSATION TOPICS?",
    "levels": ["none: unrelated", "peripheral: same field, other problem",
               "adjacent: shares machinery", "relevant: same class of problem",
               "direct: the very topics in the conversation"] },

  { "id": "relation", "type": "choice",
    "instructions": "What is PAPER's relation to the notes?",
    "options": [
      { "label": "background",  "criterion": "standard material the notes build on" },
      { "label": "advanced",    "criterion": "the same problem, treated further" },
      { "label": "unrelated",   "criterion": "unrelated work sharing terminology" },
      { "label": "cannot_tell", "criterion": "not enough shown to decide", "abstain": true }
    ] }
]
```

| field | required on | notes |
|---|---|---|
| `id` | all | stable, unique, `snake_case`. It is how you read the answer back, so changing it breaks your history |
| `type` | all | `noul`, `score` or `choice` |
| `instructions` | all | the question, addressed to the model, **in the vocabulary of your domain** |
| `levels` | `score` | ordered array, low → high, **at least two** |
| `options` | `choice` | array of `{label, criterion}`; **exactly one** must carry `"abstain": true` |
| `criteria` | `noul` | optional map `{"true": "...", "false": "..."}` describing what each answer means |

Rules that hold for all three:

* Use **the same subject placeholder** everywhere — `PAPER`, `DRAFT`, `PATIENT`, `CONTRACT`. The
  subject text is supplied separately at call time, so a question that names it explicitly is
  unambiguous about what is being judged.
* **Never put the answer in the question.** "Is this excellent paper relevant?" invites agreement.
* Option labels for `choice` are what you read back; make them short, and make the criteria
  mutually exclusive and jointly covering.

## Two kinds of set, and where their axes come from

Before writing anything, decide which kind of instrument you are building. They differ in **where the
axes come from**, and getting that wrong is the most common way to produce a set that runs cleanly and
answers nothing.

| | **screening** set | **reading** (depth) set |
|---|---|---|
| subject | many papers, **abstracts** | one or a few papers, **full text** |
| axis source | **the field** — what makes a paper relevant to this area? | **the project** — what does *this* piece of work still lack? |
| question shape | "is this about X?", "how much does it overlap?" | "does this paper contain Y?", one per open item |
| answer | a rank and a gate → a shortlist | a coverage matrix → which gaps are still open |
| how it changes | rarely; the field is stable | **every time an item closes** |
| typical size | 5–10 questions | one per open item + a few provenance questions |

**The axis source for a reading set is a specification, not a description.** A working document that
enumerates its own gaps — a notes file, a draft's TODO list, a grant's open questions, an incident
review's unresolved items — has already written your axes for you. Extract them **verbatim**; do not
paraphrase them into adjectives. "The cusp is unaddressed" becomes *"Does PAPER discuss non-analytic
behaviour in the defect's flux parameter?"* — checkable — and not *"Is PAPER useful for the cusp?"*,
which is not.

Four rules that follow, and that a screening set does not need:

1. **One open item, one question, one matrix column.** The item's `id` should be the question's `id`,
   so the matrix and the set cannot drift apart.
2. **Split compound items.** "Compute the energy" may be two axes — *any* such expression, and
   specifically the flat-space per-unit-length one. One question would return ~0.5 and tell you
   nothing; split, they separate cleanly.
3. **Keep the set in a file that gets a revision, and record which revision answered.** A paper read
   against `@1` and again against `@2` answered *different* questions. Collapsing them mixes two
   instruments into one table.
4. **Report the matrix, never a single number.** One paper is one row and says little. The output that
   matters is which columns are still empty — that is what tells you what to search for next.

**The evolution loop is the point.** Read papers → some items close → delete those items from the
spec and bump the revision → the set is now measuring the remaining gaps. A reading set that never
changes is either a project that is finished or one that is not being read.

**A reading set needs full text, and its absence must be loud.** Judging a paper's coverage from an
abstract asks a document to answer questions it mostly does not address, and a confident low
probability then reads as a finding about the paper when it is a fact about the fetch. Mark such a
read degraded, say so, and do not let it into the matrix unlabelled.

**And for a single subject there is no battery** — so embed the calibration in the set: two or three
questions whose answers you already know from having read the document yourself. If they come back
wrong, discard the whole reading. (See *Checks before you trust a set*, check 7.)

## Choosing the primitive

| you want | type | the reply is | what it is good for |
|---|---|---|---|
| whether a condition holds, **once** | `noul` | one probability | gates, yes/no admission, "does this apply" |
| a position along an **ordered** dimension | `score` | probability-weighted mean of level indices, so it falls *between* levels | ranking, grading, "how much" |
| which **one** of a defined set applies | `choice` | a label plus the distribution over labels | classification, and every judgement that depends on wording |

Three practical consequences:

1. **A `score` gives you a number for ranking; `noul` gives you a gate.** A pipeline usually wants
   one of each: `score` to sort, `noul` to exclude.
2. **Use one `noul` per independent condition**, not one question with "and" in it. "Is it relevant
   and recent?" cannot be answered honestly and cannot be debugged.
3. **When a judgement depends on the polarity of the question or the exact criteria text, ask it as a
   `choice`.** Some local checkpoints score text *agreement* rather than answering a `noul` at all —
   see Failure modes. A `choice` compares competing options and is far more robust to this.

## Wording that separates

These are the difference between a set that measures and a set that decorates.

**Anchor the subject in something checkable.** "Is PAPER about monodromy defects, or the closely
related theory of line and conformal defects in QFT?" beats "Is PAPER relevant?" — the second has no
content the model can disagree with you about.

**Separate the question from the outcome you want.** Ask *"does PAPER address the same problem?"*,
not *"should I read PAPER?"*. The first is a fact about the paper; the second smuggles in your goals,
your reading budget, and your taste, and you will not be able to tell which one moved.

**Make the levels say what they mean.** `["none: a different subject that merely shares words",
"peripheral: same field, different problem", ...]` — the gloss after the colon is what makes the
scale stable across runs. Without it, level 2 drifts.

**Give the abstain option a real criterion.** `{"label": "cannot_tell", "criterion": "the title and
abstract do not show enough to decide", "abstain": true}` gives the model somewhere honest to go. A
`choice` with no abstain forces a guess on the subjects that genuinely do not say.

**Keep the subject short enough to be read.** If the state is a 40-page paper, the answers describe
whichever part survived truncation. Say what the model is being shown, and prefer the abstract.

**One question, one decision.** If you cannot say what you would *do* differently on a `0.2` than on
a `0.8`, the question has no use — cut it, or split it.

## The expert iteration loop

This is the part that needs the physicist, and it is a loop, not a handover.

**1. Extract the axes before writing questions.** Ask the expert: *what distinguishes a paper you
must read from one you can skip?* Collect 4–8 concrete axes in their words — "does it compute the
scaling function", "is it the original source or a review", "does it assume SUSY". Do not start from
question wording; start from the distinctions they actually make.

**2. Turn each axis into one question.** An axis becomes a `noul` (holds / does not hold) or a
`score` (how far along). If an axis needs two sentences, it is two axes.

**3. Build a battery with known answers — before running anything.** Ask the expert for 6–10 real
subjects they can label: some clearly on-topic, some clearly off, and **at least two they expect to
be contentious**. This battery is the instrument's calibration, and it is worth more than any amount
of question rewording. Without it you cannot tell a working set from a confident one.

**4. Run the battery and read the disagreements, not the averages.** For each question, compare its
answer against the expert's label. The two informative outcomes are:
   * a question that returns nearly the same value for every subject — it does not separate, and it
     is not measuring what you think;
   * a question that disagrees with the expert on a **contentious** case — that is usually the
     expert discovering their own criterion was underspecified, which is the most valuable thing this
     loop produces.

**5. Rewrite one thing at a time, and re-run the same battery.** If you change three questions and
the set improves, you have learned nothing about which change worked. Keep the battery fixed; change
the set.

**6. Ask the expert where the set is wrong, not whether it is good.** "Here are three papers it
scored 0.9 that you said to skip — what is the question missing?" produces a criterion. "Is this set
good?" produces a compliment.

**7. Freeze a revision and keep its cases.** Name the set with a revision (`@1`, `@2`) and keep the
battery that calibrated it. A set without its cases cannot be safely changed later, because you will
have no way to tell whether a rewrite improved it or merely moved it.

**When the loop stalls.** If a question cannot be made to separate after two or three honest
rewrites, the judgement is probably not one this model can make. Move it to code (if it is
mechanically checkable) or leave it to the expert. **Do not tune a threshold over a question that
does not separate** — that hides the failure and keeps the number.

## Checks before you trust a set

Run these in order. They are cheap and each one catches a different way of being wrong.

1. **Does every question move?** For each question, the answers across the battery must span a real
   range. A question that returns 0.85–0.92 for everything is a constant wearing a probability.
2. **Does it separate the known cases?** On the battery, the on-topic subjects should outrank the
   off-topic ones on the question meant to rank them. If the ordering is at chance, the question is
   broken regardless of how sensible its wording is.
3. **Test the polarity.** Take one clearly on-topic and one clearly off-topic case and ask the
   *reversed* question ("is PAPER unrelated to…"). On a polarity-aware model the two answers should
   trade places. If both come back high, the model is scoring text agreement, not answering — and no
   threshold repairs that.
4. **Check where the abstain goes.** It should be chosen for subjects that genuinely lack the
   information, and rarely otherwise. An abstain chosen on clear cases means the option is a
   convenient dumping ground; an abstain never chosen means it is not needed.
5. **Look for a ceiling or floor.** If every subject scores the top level, either your battery is
   unrepresentative or the question is too easy to be useful.
6. **Read the disagreements between questions.** One question saying "directly on topic" while
   another says "unrelated word overlap" is not noise — it is a subject that sits on a boundary you
   have not defined yet. Those cases are the raw material for the next revision.
7. **For a single-subject (reading) set, check the embedded controls first.** A battery needs many
   subjects; one paper cannot be one. So put the calibration *inside* the set — two or three questions
   whose answers you already know from reading the document yourself ("is it about a monodromy
   defect?", "is it set on a sphere?"). If those come back wrong, the rest of the reading is void, and
   you know it before acting on any of it. This is the only check available when n = 1, and it is
   strictly better than reading the answers with no calibration at all.

## Failure modes

| symptom | what is happening | what to do |
|---|---|---|
| every subject gets ~0.9 | the question is a constant, or the instructions restate the subject | make the two poles concrete and checkable |
| the ordering is backwards, confidently | **polarity-blind scoring** — some checkpoints return a text-agreement score and report it as the answer you asked for. It happens on "does this text contain / do X?" questions and it is stable, so a threshold will not fix it | re-ask as a `choice` between the two readings, or move the judgement to code. Validate with check #3 |
| the answers look fine but nothing you do changes | you are thresholding a question that does not separate | go back to the battery and find a question that does |
| a subject that is clearly off-topic scores high | **proxy leakage** — the question names something correlated with your interest (a buzzword, a journal, a length) rather than the distinction itself | ask what the high-scoring off-topic cases have in common, then name *that* |
| the same subject scores very differently on two runs | the instructions are ambiguous, or the levels are not ordered by a single dimension | add the gloss after the colon in each level; remove any "and" from the instructions |
| a single number decides everything | you have blended questions that disagree | see below |

**Do not average probabilities to make one score.** Probabilities from different questions answer
different questions; their mean is a number with no referent. When two questions disagree about a
subject — one says "on topic", the other says "unrelated" — that disagreement is the finding. Prefer
a **conjunction**: require each gate to pass, and report the subjects that cleared one and failed the
other. That is how a real false positive was caught in the worked example.

## Running a set

A set is data, so running it is a call with two parts: the **subject** (the text being judged) and
the **question set**. Compose the subject so it contains everything the questions refer to — in the
worked example the subject carries both the conversation's topic profile and the paper's title and
abstract, because the questions mention both `CONVERSATION TOPICS` and `PAPER`.

In this tool, the screening set is `config/questions-*.json` and the reading set is COMPOSED from
`config/project-*.json` — its `open_items` become the coverage questions. `src/systemone.mjs` is the
whole of the conversion and the call, if you want to see exactly what is sent; the wire contract is a
POST carrying the model, the state, and the questions keyed by `id`.

Read each answer by its type — `noul` gives a probability, `score` gives the expected level and its
distribution over `levels`, `choice` gives a label and the distribution over option labels. **A
`score`'s mean is not a probability**: `3.07` on a five-level scale is a position, not 61% confidence.

## Worked example

[`worked-example.md`](worked-example.md) holds a complete five-question SCREENING set for "is this
arXiv paper relevant to these physics notes", the battery that calibrated it, the failures that were
caught, and the gate that replaced averaging. The READING set built from the same project is in
`config/project-monodromy-defects.json`, and the two-workflow pipeline is described in the README.
