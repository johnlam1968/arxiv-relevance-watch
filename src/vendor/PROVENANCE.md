# Vendored code and its provenance

Three files in this directory are **not original to this project**. They are copied, unmodified apart
from one import path, from a MIT-licensed project so that this tool has no dependency on it.

| file | copied from | license |
|---|---|---|
| `is-record.mjs` | `lib/is-record.js` | MIT |
| `questions.mjs` | `lib/model/questions.js` | MIT |
| `narrow.mjs` | `lib/model/narrow.js` | MIT |

**Source:** [dsh-system1-observer](https://github.com/johnlam1968/dsh-system1-observer) —
MIT License, Copyright (c) 2026 John Lam.

**Licence compliance.** The upstream work is MIT and its copyright holder is the same as this
repository's, so the MIT notice and permission text at the root [`LICENSE`](../../LICENSE) covers
these files as required — there is no second notice to carry. This file records the provenance, which
MIT does not require but a reader does: without it, three files here would look original.

**The only change** is the import path: `'../is-record.js'` → `'./is-record.mjs'` in
`questions.mjs` and `narrow.mjs`. No logic was altered.

## Why these three, and not a dependency

`questions.mjs` builds the three question shapes the decision service accepts, and `narrow.mjs`
reads its replies. Both are small and self-contained, and the upstream project pins their wire shape
against the vendor's own SDK in a conformance test.

Depending on the upstream package would have pulled in a DeepSeek Harness plugin — a large amount of
machinery that has nothing to do with looking at arXiv papers — for what is 325 lines. Vendoring
keeps this tool installable with no dependencies at all.

## What this means for you

If you find a bug in these three files, it is probably a bug upstream, and the fix belongs there.
If you only want to *use* this tool, nothing here needs your attention.
