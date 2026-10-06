# Worked example: "is this arXiv paper relevant to these physics notes?"

A complete, running set — the actual one, with the numbers it produced. Use it as a template for the
shape, not as a set to copy: the questions are only right for *this* subject.

## The purpose, stated first

The subject is a set of graduate physics notes titled *Monodromy Defects in Quantum Field Theory*.
The set's job is to let a researcher find, among arXiv search results, the papers worth reading —
and to keep doing so on a schedule, unattended.

Two things that shaped every question below:

* The notes are **specific**: a monodromy (twist) line defect in 3d, and an uncomputed scaling
  function `C(v)` for its Casimir energy. Broad "quantum field theory" interest would have made every
  hep-th paper score high and the set useless.
* The retrieval is **by keyword**, and the keywords have homonyms. "Scaling function" is a term of
  art in lattice QCD and in statistics; "defect" is a term of art in materials science. A set that
  cannot tell those apart is not an instrument.

## The set

```json
[
  { "id": "paper_on_topic", "type": "noul",
    "instructions": "Is PAPER about monodromy (twist) defects, or the closely related theory of line and conformal defects in quantum field theory?" },

  { "id": "paper_topic_overlap", "type": "score",
    "instructions": "How much of PAPER's actual subject matter overlaps the TOPIC PROFILE, independent of whether PAPER agrees with it?",
    "levels": [
      "none: a different subject that merely shares words",
      "peripheral: the same broad field, a different problem",
      "adjacent: shares concepts or machinery, not the problem",
      "relevant: addresses the same class of problem",
      "direct: addresses the very topics and problems described in the profile"
    ] },

  { "id": "paper_answers_open_problem", "type": "noul",
    "instructions": "Does PAPER help with the open problems of this subject -- computing the scaling function C(v) of the Casimir energy for a monodromy line defect, the gauging procedure that makes the defect dynamical, or the topological quantization condition?" },

  { "id": "paper_worth_reading", "type": "noul",
    "instructions": "Would a researcher working on this subject need to read PAPER?" },

  { "id": "paper_relation", "type": "choice",
    "instructions": "What is PAPER's relation to this subject?",
    "options": [
      { "label": "foundational_background", "criterion": "standard textbook material the subject builds on" },
      { "label": "same_problem_advanced",   "criterion": "the same problem treated further or more rigorously" },
      { "label": "different_setting",       "criterion": "a different setting or dimension whose methods transfer" },
      { "label": "unrelated_word_overlap",  "criterion": "unrelated work that happens to share terminology" },
      { "label": "cannot_tell",             "criterion": "the title and abstract do not show enough to decide", "abstain": true }
    ] }
]
```

**The subject carries both halves.** The questions name `PAPER` and `TOPIC PROFILE`, so the
state supplied at call time must contain both — the extracted topic profile, then the paper's title,
authors, date, categories and abstract. A question that refers to something absent from the state is
answered anyway, and the answer is worthless.

**Why `paper_on_topic` is nearly a duplicate of `paper_topic_overlap`.** It is not. One is a
`score` (how far along a dimension) and the other a `noul` gate (does the central condition hold),
and they disagreed on real subjects in a way that mattered — see below. The redundancy is
deliberate: they fail differently.

## The battery

Six real subjects, labelled by hand before the set was trusted. `rank` is the normalized `score`
(expected level ÷ 4).

| paper | hand label | `overlap` rank | `on_topic` | `relation` |
|---|---|---|---|---|
| Remarks on spherical monodromy defects for free scalar fields | must read | 0.93 | 0.97 | same_problem_advanced |
| Monodromy Defects from Hyperbolic Space | must read | 0.90 | 0.98 | same_problem_advanced |
| Bootstrapping Monodromy Defects in the Wess-Zumino Model | must read | 0.88 | 0.98 | same_problem_advanced |
| The step scaling function of QCD at negative flavor number | **skip** | 0.66 | 0.02 | unrelated_word_overlap |
| The Ising Susceptibility Scaling Function | **skip** | 0.62 | 0.07 | same_problem_advanced |
| Color defects in a gauge condensate | **skip** | 0.59 | 0.26 | unrelated_word_overlap |

Check the set against the four checks in the parent skill:

* **Does each question move?** Yes — `on_topic` spans 0.02 to 0.98, `overlap` spans 0.15 to 0.93
  across the full 88-paper run.
* **Does it separate?** The three "must read" papers sit at 0.88–0.93; the three "skip" papers at
  0.59–0.66 — separated, but **not enough**, which is the finding below.
* **Where does the abstain go?** 7 of 88 subjects landed on `cannot_tell`, all of them titles with
  no abstract-level detail. That is the option behaving.
* **Any ceiling?** No: 0.93 was the maximum, and nothing saturated.

## What the battery caught

**A blended score would have failed.** The three "skip" papers scored 0.59–0.66 on `overlap` while
scoring 0.02–0.26 on `on_topic`. On a single averaged score, *The step scaling function of QCD* would
have ranked above nothing in particular but comfortably inside the output; ranked on `overlap` alone
it reached **0.82** on a later run for the sibling paper *The scaling function at strong coupling
from the quantum string* — inside the top ten of 88.

The fix was **not** to tune a threshold and not to average the two questions. It was to require both
and to report what the gate removed. Nine papers were removed that way, all of them sharing the wrong
sense of "scaling function". The disagreement between the two questions *is* the signal; averaging
deletes it.

**The `choice` question can be fooled where the gate is not.** *The Ising Susceptibility Scaling
Function* scored `same_problem_advanced` on `paper_relation` — the label a genuinely relevant paper
gets — while `on_topic` said 0.07. A set relying only on the `choice` would have kept it. This is
the case for having one question that names the central condition **plainly, with no room for
vocabulary overlap**, and treating it as the gate.

**A `score` is a position, not a probability.** The wires return `score`; a reader that normalizes it
must divide by the number of levels minus one. Reading it as if it were already a probability makes
every paper look like it scored 300%. This is the kind of error that shows up as "everything is
relevant" and gets blamed on the model.

## What a physicist would change next

The set currently measures *how much a paper is about these notes*. It does not measure:

* **whether the paper is a source or a review** — a survey of defect CFTs is useful differently from
  the paper that first computed a monodromy defect's Casimir energy;
* **whether the paper's methods transfer** — a question the notes raise but this set does not ask:
  "does this give me the technique I am missing?";
* **whether it is superseded** — a 2014 paper and its 2026 replacement score identically.

Each is a real axis an expert would name, and each becomes one more question. That is the iteration
loop: the failure of this revision is the specification of the next one.
