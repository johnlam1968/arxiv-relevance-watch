// The parts that can be tested without a network or a model.
//
// These are deliberately about SHAPE and ARITHMETIC rather than about judgement: whether arXiv
// returns the right papers, or the model gives the right probabilities, is not something a unit test
// can assert. What it can assert is that this tool reads a reply correctly -- which is where the two
// real bugs found while building it lived (the `score`/`level` field name, and the result shape).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAtom, arxivStamp, withDateRange } from '../src/arxiv.mjs'
import { buildQueries, extractTopics, loadTopics, profileOf } from '../src/topics.mjs'
import { buildWireQuestions, narrowAnswers } from '../src/systemone.mjs'

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: search_query=all:electron</title>
  <entry>
    <id>http://arxiv.org/abs/2104.09419v2</id>
    <updated>2021-04-20T00:00:00Z</updated>
    <published>2021-04-19T18:00:00Z</published>
    <title>Remarks on spherical monodromy defects
  for free scalar fields</title>
    <summary>  We study a free scalar field with a monodromy defect &amp; compute
  its Casimir energy.  </summary>
    <author><name>First Author</name></author>
    <author><name>Second Author</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="hep-th"/>
    <category term="hep-th"/>
    <category term="math-ph"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/9999.00001v1</id>
    <published>2026-01-01T00:00:00Z</published>
    <title>An unrelated paper</title>
    <summary>Nothing to do with defects.</summary>
  </entry>
</feed>`

test('parseAtom reads the fields the ranker uses', () => {
  const papers = parseAtom(FEED)
  assert.equal(papers.length, 2)
  const [first] = papers
  assert.equal(first.id, 'http://arxiv.org/abs/2104.09419v2')
  // Whitespace inside a feed element is folded, not preserved: the API wraps long titles.
  assert.equal(first.title, 'Remarks on spherical monodromy defects for free scalar fields')
  // XML entities are decoded, or a title carrying `&amp;` reaches the judge mangled.
  assert.match(first.abstract, /monodromy defect & compute/)
  assert.deepEqual(first.authors, ['First Author', 'Second Author'])
  assert.deepEqual(first.categories, ['hep-th', 'math-ph'])
  assert.equal(first.published, '2021-04-19T18:00:00Z')
})

test('parseAtom does not confuse the feed title with an entry title', () => {
  const papers = parseAtom(FEED)
  assert.equal(papers[0].title.startsWith('ArXiv Query'), false)
})

test('arXiv date stamps are UTC and zero-padded', () => {
  // 2026-01-02T03:04:00Z
  assert.equal(arxivStamp(Date.UTC(2026, 0, 2, 3, 4)), '202601020304')
  assert.equal(
    withDateRange('all:"x"', Date.UTC(2026, 0, 2, 3, 4), Date.UTC(2026, 1, 3, 4, 5)),
    '(all:"x") AND submittedDate:[202601020304 TO 202602030405]',
  )
})

test('extractTopics counts mentions, weights by specificity, and sorts', () => {
  const lexicon = [
    { id: 'common', label: 'common', patterns: ['defect'], query: '"defect"', weight: 1 },
    { id: 'rare', label: 'rare', patterns: ['monodromy defect'], query: '"monodromy defect"', weight: 10 },
    { id: 'absent', label: 'absent', patterns: ['never mentioned'], query: '"nope"', weight: 99 },
  ]
  const topics = extractTopics('A monodromy defect. Another defect. A third defect.', lexicon)
  assert.deepEqual(topics.map((t) => t.id), ['rare', 'common'], 'absent topics are dropped, not scored zero')
  assert.equal(topics[0].hits, 1)
  assert.equal(topics[0].score, 10)
  assert.equal(topics[1].hits, 3)
  assert.equal(topics[1].score, 3)
})

test('buildQueries separates the precise queries from the broad ones', () => {
  const topics = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id, query: `"${id}"`, weight: 1 }))
  const queries = buildQueries(topics)
  const precise = queries.filter((q) => q.precise)
  const broad = queries.filter((q) => !q.precise)
  assert.equal(broad.length, 4, 'four single-topic queries')
  assert.ok(precise.length > 0, 'at least one AND query')
  for (const q of precise) assert.match(q.expr, / AND /)
  // No duplicates: a repeated query is a wasted request against a rate-limited API.
  assert.equal(new Set(queries.map((q) => q.expr)).size, queries.length)
})

test('profileOf names the topics the questions will refer to', () => {
  const profile = profileOf([{ label: 'alpha', hits: 7 }, { id: 'beta', hits: 0 }])
  assert.equal(profile, '- alpha (7 mentions)\n- beta')
})

test('the shipped config loads and passes its own validation', () => {
  const { lexicon, profile, name } = loadTopics(new URL('../config/topics-monodromy-defects.json', import.meta.url).pathname)
  assert.ok(lexicon.length >= 10)
  assert.ok(typeof name === 'string' && name.length > 0)
  assert.ok(typeof profile === 'string' && profile.includes('monodromy'))
  for (const topic of lexicon) {
    assert.ok(topic.patterns.every((p) => p === p.toLowerCase()), `${topic.id}: patterns must be lowercase, matching is done on a lowered haystack`)
  }
})

test('a malformed topic config is refused, not silently accepted', () => {
  const bad = new URL('./fixtures/bad-topics.json', import.meta.url).pathname
  assert.throws(() => loadTopics(bad), /needs a non-empty "patterns"/)
})

test('buildWireQuestions converts a score to an ordered criteria array and a choice to a map', () => {
  const specs = [
    { id: 'gate', type: 'noul', instructions: 'Does it hold?' },
    { id: 'how_much', type: 'score', instructions: 'How much?', levels: ['none', 'some', 'all'] },
    {
      id: 'which',
      type: 'choice',
      instructions: 'Which?',
      options: [
        { label: 'yes', criterion: 'it does' },
        { label: 'no', criterion: 'it does not' },
        { label: 'unknown', criterion: 'not shown', abstain: true },
      ],
    },
  ]
  const wire = buildWireQuestions(specs)
  assert.equal(wire.gate.type, 'noul')
  // The service rejects a score whose criteria is a map: it must be an ordered list.
  assert.deepEqual(wire.how_much.criteria, ['none', 'some', 'all'])
  // ...and rejects a choice whose criteria is a list: it must be a map keyed by label.
  assert.deepEqual(Object.keys(wire.which.criteria), ['yes', 'no', 'unknown'])
})

test('buildWireQuestions refuses a set that is wrong before any call is made', () => {
  assert.throws(() => buildWireQuestions([{ type: 'noul', instructions: 'no id' }]), /needs a non-empty `id`/)
  assert.throws(() => buildWireQuestions([{ id: 'a', type: 'noul', instructions: 'x' }, { id: 'a', type: 'noul', instructions: 'y' }]), /duplicate question id/)
  assert.throws(() => buildWireQuestions([{ id: 'a', type: 'likert', instructions: 'x' }]), /unknown type/)
  assert.throws(() => buildWireQuestions([{ id: 'a', type: 'choice', instructions: 'x', options: [{ label: 'only', criterion: 'c' }] }]), /at least two options/)
})

test('a score reply is read as `level`, from the wire field `score`', () => {
  // THE BUG THIS PINS: the wire calls it `score`, the reader returns `level`, and reading the wire's
  // name gave `null` for every paper -- which looked like "nothing is relevant" rather than a bug.
  const questions = buildWireQuestions([{ id: 'overlap', type: 'score', instructions: 'How much?', levels: ['none', 'slight', 'some', 'much', 'direct'] }])
  const narrowed = narrowAnswers({
    answers: { overlap: { type: 'score', score: 3.07, legend: {}, probabilities: { 0: 0, 1: 0.05, 2: 0.19, 3: 0.4, 4: 0.36 }, confidence: 0.45 } },
  }, questions)
  assert.equal(narrowed.kind, 'ok')
  assert.equal(narrowed.answers.overlap.level, 3.07)
  assert.equal(narrowed.answers.overlap.score, undefined, 'the wire name is not what comes back')
})

test('a reply that is readable but wrong is marked, not trusted', () => {
  const questions = buildWireQuestions([{ id: 'gate', type: 'noul', instructions: 'Does it hold?' }])
  // A noul answered with a score: the shape is readable, and it answers a different question.
  const narrowed = narrowAnswers({ answers: { gate: { type: 'score', score: 1 } } }, questions)
  assert.equal(narrowed.answers.gate.type, 'unreadable')

  // A probability outside [0,1] is readable and impossible.
  const impossible = narrowAnswers({ answers: { gate: { type: 'noul', noul: 1.8 } } }, questions)
  assert.equal(impossible.answers.gate.invalid, true)
  assert.match(impossible.answers.gate.invalidReason, /not a finite number in \[0,1\]/)
})

test('a choice answered with an option that was never offered is unreadable', () => {
  const questions = buildWireQuestions([{
    id: 'rel',
    type: 'choice',
    instructions: 'Which?',
    options: [
      { label: 'a', criterion: 'first' },
      { label: 'b', criterion: 'second' },
      { label: 'abstain', criterion: 'cannot tell', abstain: true },
    ],
  }])
  const narrowed = narrowAnswers({ answers: { rel: { type: 'choice', choice: 'c', confidence: 0.9 } } }, questions)
  assert.equal(narrowed.answers.rel.type, 'unreadable')
  assert.match(narrowed.answers.rel.reason, /never offered/)
})
