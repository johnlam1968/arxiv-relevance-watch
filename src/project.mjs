// THE PROJECT SPEC: the axis source for the reading workflow.
//
// This is the file that makes a depth question set EVOLVING rather than fixed. A screening set is
// derived from the field ("what makes a paper relevant?") and barely changes. A depth set is derived
// from ONE PROJECT'S OWN STATEMENT OF WHAT IT LACKS -- and that list changes every time a paper
// closes an item or a new gap is discovered.
//
// So the open items live here, as first-class data, and the question set is COMPOSED from them. Three
// consequences, all of them the point:
//
//   * each open item is both a question and a COLUMN of the coverage matrix, so "which items are
//     still uncovered" is a thing the tool can answer rather than something a person tracks by hand;
//   * closing an item is editing this file -- a new revision is one line changed, not a rewrite;
//   * a question that stops being asked is visible in git history, so the instrument's own evolution
//     is recorded beside its readings.
//
// `context` is prose and goes into the judged state verbatim. Write it as a description of the
// project for someone who has not read the notes, and keep it narrow.

import { readFileSync } from 'node:fs'

/**
 * Load and validate a project spec.
 *
 * @param {string} path
 * @returns {{name: string, context: string, revision: string, openItems: Array, extraQuestions: Array}}
 */
export function loadProject(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const where = path

  if (typeof parsed.name !== 'string' || parsed.name.trim() === '') throw new Error(`${where}: needs a "name"`)
  if (typeof parsed.context !== 'string' || parsed.context.trim() === '') throw new Error(`${where}: needs a "context" -- the prose the judge is shown`)

  const openItems = parsed.open_items
  if (!Array.isArray(openItems) || openItems.length === 0) throw new Error(`${where}: needs a non-empty "open_items" array`)

  const seen = new Set()
  for (const [index, item] of openItems.entries()) {
    const at = `${where}: open_items[${index}]`
    if (typeof item.id !== 'string' || item.id.trim() === '') throw new Error(`${at} needs an "id"`)
    if (seen.has(item.id)) throw new Error(`${at}: duplicate id ${item.id}`)
    seen.add(item.id)
    if (typeof item.label !== 'string' || item.label.trim() === '') throw new Error(`${at} (${item.id}) needs a "label"`)
    // The question is what reaches the model, so it has to stand alone: a bare label like "the cusp"
    // is not answerable, and forcing the author to phrase it is the point of the field.
    if (typeof item.question !== 'string' || item.question.trim() === '') throw new Error(`${at} (${item.id}) needs a "question" -- the full sentence asked about PAPER`)
  }

  const extraQuestions = parsed.questions ?? []
  if (!Array.isArray(extraQuestions)) throw new Error(`${where}: "questions" must be an array when present`)
  for (const [index, spec] of extraQuestions.entries()) {
    const at = `${where}: questions[${index}]`
    if (typeof spec.id !== 'string' || spec.id.trim() === '') throw new Error(`${at} needs an "id"`)
    if (seen.has(spec.id)) throw new Error(`${at}: duplicate id ${spec.id} (an open item already uses it)`)
    seen.add(spec.id)
  }

  return {
    name: parsed.name,
    context: parsed.context,
    revision: typeof parsed.revision === 'string' ? parsed.revision : 'unversioned',
    openItems,
    extraQuestions,
  }
}

/**
 * Compose the depth question set from the project spec.
 *
 * The coverage questions come first, one per open item, and are marked so the reader can tell a
 * matrix column from a provenance question. Control questions in `questions` are the caller's
 * business -- but they belong in the set, because a single subject has no battery to calibrate
 * against (see the authoring guide).
 */
export function composeQuestionSet(project) {
  const coverage = project.openItems.map((item) => ({
    id: item.id,
    type: 'noul',
    instructions: item.question,
    coverage: true,
    label: item.label,
  }))
  return {
    specs: [...coverage, ...project.extraQuestions],
    coverageIds: coverage.map((c) => c.id),
  }
}

/**
 * A coverage matrix: papers down the side, open items across the top.
 *
 * This is the reading workflow's real output. One paper is one row and says little; the value is in
 * seeing which items several papers still leave uncovered, which is what tells you what to search for
 * next. Probabilities are never averaged -- a cell is one paper's answer to one item.
 *
 * @param {Array} rows    `{ paperId, title, answers }`
 * @param {Array} items   open items, in the order they should be columns
 */
export function coverageMatrix(rows, items) {
  const columns = items.map((item) => {
    const answers = rows
      .map((row) => ({ paperId: row.paperId, title: row.title, value: row.answers?.[item.id]?.probability ?? null }))
      .filter((a) => a.value !== null)
    return {
      id: item.id,
      label: item.label,
      answered: answers.length,
      // "Covered" is a threshold on a probability, and the threshold is the reader's decision, not
      // this function's -- so the maximum is reported and the caller judges.
      best: answers.length === 0 ? null : answers.reduce((a, b) => (b.value > a.value ? b : a)),
      bestValue: answers.length === 0 ? null : Math.max(...answers.map((a) => a.value)),
    }
  })
  return {
    papers: rows.length,
    items: items.length,
    columns,
    uncovered: columns.filter((c) => c.bestValue === null),
  }
}
