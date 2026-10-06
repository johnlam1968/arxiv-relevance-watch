# Configuration reference

Every file this tool reads, in prose, with the rules it enforces. Written so that an assistant
**without a shell** can author a valid file and check its own work.

The validation rules below are the ones the code actually applies. A file that breaks one stops the
run with a message naming the field — so a mistake is loud, not silent. The examples in this document
are extracted and validated by the test suite, so they cannot drift from the validators.

---

## 1. `config/topics-*.json` — the screening axis source

**Read by:** `src/cli.mjs` (`arxiv-watch`), via `src/topics.mjs`.
**Answers:** what am I looking for, and what do I search arXiv for?

```json topics
{
  "name": "my subject",
  "profile": "- the specific thing I work on\n- a second specific thing",
  "topics": [
    { "id": "my_topic",
      "label": "human-readable name",
      "patterns": ["how i write it", "another spelling"],
      "query": "\"exact phrase for arXiv\"",
      "weight": 10 }
  ]
}
```

| field | required | rule |
|---|---|---|
| `name` | no | string. Used in report titles. |
| `profile` | no | string. Prose put in the judged state when you run **without** `--text`. Write it yourself, keep it narrow. |
| `topics` | **yes** | non-empty array. A bare top-level array is also accepted. |
| `topics[].id` | **yes** | non-empty string. Must be unique. |
| `topics[].patterns` | **yes** | non-empty array of strings, matched as **lowercase substrings** against a lowercased document. |
| `topics[].query` | **yes** | non-empty string. An arXiv search expression. |
| `topics[].weight` | **yes** | a finite number. Specificity: a phrase that means your topic and nothing else deserves ~10; a phrase with a large unrelated literature deserves ~3. |
| `topics[].label` | no | string. Human-readable; falls back to `id`. |

**Rules that are not enforced but decide whether it works:**

* **Keep the profile narrow.** `"quantum field theory"` makes every hep-th paper relevant and the tool
  useless. Name the specific thing.
* **`patterns` must be lowercase.** Matching happens against a lowercased haystack, so an uppercase
  pattern silently never matches. The test suite checks the shipped config for this.
* **`query` is raw arXiv syntax.** `"quoted phrase"` for a phrase, `A AND B` for a conjunction,
  `abs:` to restrict to abstracts.

## 2. `config/project-*.json` — the reading axis source

**Read by:** `src/read.mjs` (`arxiv-read`), via `src/project.mjs`.
**Answers:** what does my work still lack? Each open item becomes **both one question and one column
of the coverage matrix**, which is why the ids are the same thing in two places.

```json project
{
  "name": "my subject",
  "revision": "open-items@1",
  "context": "Prose describing the project for someone who has not read my notes. Setting, goal, and what is already settled.",
  "open_items": [
    { "id": "covers_the_gap",
      "label": "the gap, in three words",
      "question": "Does PAPER contain an explicit expression for the thing I still need?" }
  ],
  "questions": [
    { "id": "ctrl_is_about_the_subject", "type": "noul",
      "instructions": "Is PAPER about the subject at all?" }
  ]
}
```

| field | required | rule |
|---|---|---|
| `name` | **yes** | non-empty string. |
| `context` | **yes** | non-empty string. Goes into the judged state verbatim. |
| `revision` | no | string; defaults to `unversioned`. **Bump it whenever `open_items` changes.** |
| `open_items` | **yes** | non-empty array. |
| `open_items[].id` | **yes** | non-empty string, unique across the whole file. |
| `open_items[].label` | **yes** | non-empty string. Shown in the matrix; keep it short. |
| `open_items[].question` | **yes** | non-empty string. **The full sentence asked of every paper** — a bare label is refused. |
| `questions` | no | array of question specs (§3). Ids must not collide with any `open_item` id. |

**Why `question` is separate from `label`, and required.** The label is for the matrix; the question is
what reaches the model, and it has to stand alone. `"the cusp"` is not answerable. `"Does PAPER discuss
non-analytic behaviour in the defect's flux parameter?"` is. The validator refuses a missing question
rather than falling back to the label, because a fallback would produce a set that runs and measures
nothing.

**Bump `revision` when you close an item.** Reads are recorded per revision, so a paper read against
`@1` and again against `@2` is kept as two records — it answered different questions. Forgetting to
bump mixes two instruments into one matrix.

**Aim for 5–10 open items.** Fewer and there is nothing to screen; more and the set is a wish list
rather than a specification.

## 3. Question specs — shared by both configs

Used in `config/questions-*.json` (screening) and in `project.questions` (reading).

```json questions
[
  { "id": "on_topic", "type": "noul",
    "instructions": "Is PAPER about the specific subject described above?" },

  { "id": "how_much", "type": "score",
    "instructions": "How much does PAPER overlap the subject?",
    "levels": ["none", "peripheral", "adjacent", "relevant", "direct"] },

  { "id": "relation", "type": "choice",
    "instructions": "What is PAPER's relation to the subject?",
    "options": [
      { "label": "primary", "criterion": "the original computation" },
      { "label": "reworking", "criterion": "a re-derivation published later" },
      { "label": "cannot_tell", "criterion": "not enough shown", "abstain": true }
    ] }
]
```

| field | required on | rule |
|---|---|---|
| `id` | all | non-empty string, unique within the set. It is how the answer is read back, so changing it breaks your history. |
| `type` | all | exactly `noul`, `score` or `choice`. Anything else is refused. |
| `instructions` | all | non-empty string. The question, in your domain's vocabulary. |
| `levels` | `score` | ordered array, low → high, **at least two**. |
| `options` | `choice` | array of `{label, criterion}`, **at least two**, and **exactly one** must carry `"abstain": true`. |
| `criteria` | `noul` | optional map `{"true": "...", "false": "..."}`. |

**Rules that are not enforced but decide whether it works:**

* Name your subject with **one consistent placeholder** (`PAPER`, `DRAFT`) and make sure the state
  actually contains what the questions refer to.
* **Never put the answer in the question.** "Is this excellent paper relevant?" invites agreement.
* **One question, one decision.** If you cannot say what you would do differently on a `0.2` than on a
  `0.8`, cut it.
* **`choice` options must be mutually exclusive and jointly covering.** Overlapping options produce a
  label that disagrees with your `noul` questions — a real defect that was caught this way.
* For a **single-subject** reading set there is no battery to calibrate against, so include two or
  three questions whose answers you already know from reading the document yourself. If those come
  back wrong, discard the reading.

See [authoring-question-sets.md](authoring-question-sets.md) for how to build and iterate a set.

## 4. Topic-config lookup order

For `arxiv-watch`, `--topics` otherwise the default `config/topics-monodromy-defects.json`. For
`arxiv-read`, `--project` otherwise `config/project-monodromy-defects.json`.

To point either at your own: pass the flag, and pass `--name <stem>` so the report filename is yours
rather than the topic's.

## 5. Validating without running anything

You can check a file by hand against the tables above. The rules that catch most real mistakes:

1. every `id` unique **across the file** — an `open_item` id and a `questions[].id` may not collide;
2. `patterns` all lowercase;
3. at least two `levels` for a `score`, at least two `options` for a `choice`;
4. **exactly one** `abstain: true` in a `choice` — not zero, not two;
5. a `question` on every open item, phrased as a full sentence ending in `?`;
6. `revision` bumped if `open_items` changed.

The tool re-checks all of these at load and stops with a message naming the field, so a file that
fails never produces a partial run.
