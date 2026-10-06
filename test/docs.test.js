// THE DOCS MUST NOT DRIFT FROM THE VALIDATORS.
//
// docs/config-reference.md is written for an assistant that has no shell and therefore cannot run
// anything to check its work. That makes the document a load-bearing artifact: if it shows a config
// the loader would reject, the assistant writes a broken file and the human finds out by running it.
//
// So the JSON examples in that document are EXTRACTED AND VALIDATED here, by the same loaders the
// tool uses. A fence tagged `json topics` goes through `loadTopics`; `json project` through
// `loadProject`; `json questions` through the vendored builder. Edit the doc and break an example,
// and this test fails before a reader ever sees it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTopics } from '../src/topics.mjs'
import { loadProject } from '../src/project.mjs'
import { buildWireQuestions } from '../src/systemone.mjs'

const DOC = new URL('../docs/config-reference.md', import.meta.url).pathname

/** Every fenced block, tagged by the language info string. */
function fencedBlocks(markdown) {
  const blocks = []
  for (const match of markdown.matchAll(/```(\w+)([^\n]*)\n([\s\S]*?)```/g)) {
    blocks.push({ tag: match[1], info: match[2].trim(), body: match[3] })
  }
  return blocks
}

const blocks = fencedBlocks(readFileSync(DOC, 'utf8'))
const scratch = mkdtempSync(join(tmpdir(), 'config-reference-'))
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }))

test('the config reference contains an example of every kind', () => {
  const tags = blocks.map((b) => `${b.tag} ${b.info}`.trim())
  assert.ok(tags.includes('json topics'), 'no topics example')
  assert.ok(tags.includes('json project'), 'no project example')
  assert.ok(tags.includes('json questions'), 'no question-set example')
})

test('the topics example is accepted by the loader that reads it', () => {
  const example = blocks.find((b) => b.tag === 'json' && b.info === 'topics')
  const path = join(scratch, 'topics.json')
  writeFileSync(path, example.body)
  const loaded = loadTopics(path)
  assert.ok(loaded.lexicon.length > 0)
  for (const topic of loaded.lexicon) {
    // The reference states this rule in prose; check the example obeys it too.
    assert.ok(topic.patterns.every((p) => p === p.toLowerCase()), `${topic.id}: patterns must be lowercase`)
  }
})

test('the project example is accepted by the loader that reads it', () => {
  const example = blocks.find((b) => b.tag === 'json' && b.info === 'project')
  const path = join(scratch, 'project.json')
  writeFileSync(path, example.body)
  const project = loadProject(path)
  assert.ok(project.openItems.length > 0)
  for (const item of project.openItems) {
    assert.ok(item.question.trim().endsWith('?'), `${item.id}: the documented example should show a real question`)
  }
})

test('the questions example is accepted by the vendored builders', () => {
  const example = blocks.find((b) => b.tag === 'json' && b.info === 'questions')
  const wire = buildWireQuestions(JSON.parse(example.body))
  // The three primitives, each reduced to the wire shape the service actually takes.
  assert.equal(wire.on_topic.type, 'noul')
  assert.deepEqual(wire.how_much.criteria, ['none', 'peripheral', 'adjacent', 'relevant', 'direct'])
  assert.deepEqual(Object.keys(wire.relation.criteria), ['primary', 'reworking', 'cannot_tell'])
})

test('the reference documents the rules the validators actually enforce', () => {
  const doc = readFileSync(DOC, 'utf8')
  // Field names an assistant has to know. Matched as WORDS rather than as exact backticked tokens,
  // because the reference names a nested field as `topics[].weight` in its table -- the requirement
  // is that the document mentions the field, not that it uses one particular notation.
  for (const field of ['open_items', 'patterns', 'query', 'weight', 'revision', 'levels', 'options', 'abstain', 'instructions', 'label']) {
    assert.match(doc, new RegExp(`\\b${field}\\b`), `config-reference.md never mentions ${field}`)
  }
  // And the two rules that are most often got wrong, stated where an assistant will read them.
  assert.match(doc, /exactly one[\s\S]{0,40}abstain|abstain[\s\S]{0,40}exactly one/i)
  assert.match(doc, /lowercase/)
})
