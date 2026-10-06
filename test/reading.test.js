// The reading workflow's testable parts: the project spec, the composed set, the matrix, and the
// full-text reducer. As with the screening tests, these are about SHAPE and ARITHMETIC -- whether a
// coverage probability is *right* is not something a unit test can assert.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeQuestionSet, coverageMatrix, loadProject } from '../src/project.mjs'
import { htmlToProse } from '../src/fulltext.mjs'

const PROJECT = new URL('../config/project-monodromy-defects.json', import.meta.url).pathname

test('the shipped project spec loads and passes its own validation', () => {
  const project = loadProject(PROJECT)
  assert.ok(project.name.length > 0)
  assert.ok(project.context.includes('monodromy'))
  assert.ok(project.openItems.length >= 5)
  assert.match(project.revision, /@\d+$/, 'a revision must be versioned, or reads cannot be told apart')
  for (const item of project.openItems) {
    // A label is for humans; a question must stand alone for the model.
    assert.ok(item.question.trim().endsWith('?'), `${item.id}: the question must be a question`)
    assert.ok(item.question.length > 40, `${item.id}: the question is too short to answer without the label`)
  }
})

test('a malformed project spec is refused, with the reason', () => {
  const bad = (body) => new URL(`./fixtures/${body}`, import.meta.url).pathname
  assert.throws(() => loadProject(bad('project-no-context.json')), /needs a "context"/)
  assert.throws(() => loadProject(bad('project-bare-label.json')), /needs a "question"/)
  assert.throws(() => loadProject(bad('project-duplicate.json')), /duplicate id/)
})

test('the composed set is one coverage question per open item, then the extra questions', () => {
  const project = loadProject(PROJECT)
  const { specs, coverageIds } = composeQuestionSet(project)
  assert.equal(coverageIds.length, project.openItems.length)
  assert.deepEqual(coverageIds, project.openItems.map((i) => i.id))
  // Every coverage question is a noul: "does this paper address item X" is a condition, not a degree.
  for (const spec of specs.filter((s) => s.coverage === true)) assert.equal(spec.type, 'noul')
  // The composed set must be a valid set: unique ids, and the vendored builders accept it.
  assert.equal(new Set(specs.map((s) => s.id)).size, specs.length)
  assert.equal(specs.length, project.openItems.length + project.extraQuestions.length)
})

test('the matrix reports the best paper per column and never averages', () => {
  const items = [{ id: 'a', label: 'item a' }, { id: 'b', label: 'item b' }, { id: 'c', label: 'item c' }]
  const rows = [
    { paperId: 'p1', title: 'first', answers: { a: { probability: 0.9 }, b: { probability: 0.1 } } },
    { paperId: 'p2', title: 'second', answers: { a: { probability: 0.3 }, b: { probability: 0.8 }, c: { probability: 0.2 } } },
    { paperId: 'p3', title: 'third', answers: { a: { probability: 0.5 } } },
  ]
  const matrix = coverageMatrix(rows, items)
  const byId = Object.fromEntries(matrix.columns.map((c) => [c.id, c]))

  assert.equal(byId.a.bestValue, 0.9, 'the maximum, not a mean')
  assert.equal(byId.a.best.paperId, 'p1')
  assert.equal(byId.b.bestValue, 0.8)
  assert.equal(byId.b.best.paperId, 'p2', 'p2 beats p1 on b even though p1 is stronger on a')
  assert.equal(byId.c.bestValue, 0.2)

  assert.equal(matrix.papers, 3)
  assert.equal(matrix.items, 3)
  assert.ok(matrix.columns.every((c) => c.answered > 0), 'every column here has at least one answer')
})

test('a column nothing answered is reported as unanswered, not as zero', () => {
  const matrix = coverageMatrix([{ paperId: 'p1', title: 't', answers: { a: { probability: 0.4 } } }],
    [{ id: 'a', label: 'a' }, { id: 'never', label: 'never asked' }])
  const never = matrix.columns.find((c) => c.id === 'never')
  // 0 and "nobody answered" are different facts, and conflating them is how a gap gets hidden.
  assert.equal(never.bestValue, null)
  assert.equal(never.best, null)
  assert.deepEqual(matrix.uncovered.map((c) => c.id), ['never'])
})

test('records without a probability do not count as an answer', () => {
  const matrix = coverageMatrix([{ paperId: 'p1', title: 't', answers: { a: { type: 'unreadable', reason: 'no answer' } } }],
    [{ id: 'a', label: 'a' }])
  assert.equal(matrix.columns[0].answered, 0)
  assert.equal(matrix.columns[0].bestValue, null)
})

test('htmlToProse returns prose and drops equation debris', () => {
  const html = `<html><head><style>p{}</style></head><body>
    <h2>1. Introduction</h2>
    <p>The computation of the effect of a simple monodromy defect in the case of a sphere with twisted
    boundary conditions is revisited and streamlined using earlier calculations.</p>
    <p>\\[ x = \\frac{1}{2} \\mathchar 28944\\relax + {\\hbox{\\viiptrm 1}} \\]</p>
    <p>In even dimensions this is a computation of the conformal anomaly, which is the coefficient of
    the logarithmic divergence appearing there.</p>
    <script>var x = 1;</script>
    </body></html>`
  const prose = htmlToProse(html)
  assert.match(prose.text, /revisited and streamlined/)
  assert.match(prose.text, /conformal anomaly/)
  assert.doesNotMatch(prose.text, /var x = 1/, 'script content must not leak in')
  assert.doesNotMatch(prose.text, /viiptrm/, 'LaTeX scaffolding must be stripped')
  assert.ok(prose.chars > 100)
})

test('htmlToProse substitutes the private-use characters ar5iv emits', () => {
  // Measured on a real paper: the flux parameter delta arrives as U+FB03 when the math renderer
  // falls back. A judge reading "the flux parameter \uFB03" has to guess.
  const prose = htmlToProse('<p>From the definition of the monodromy, a periodicity of 1 in \uFB03 must be imposed on all physical quantities here.</p>')
  assert.match(prose.text, /periodicity of 1 in delta/)
  assert.doesNotMatch(prose.text, /\uFB03/)
})
