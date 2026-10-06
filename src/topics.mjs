// TOPICS: from a document, deterministically.
//
// The whole reason this tool can exist without a language model is that *what you are looking for* is
// written down in advance, in a file you can read and edit. This module is the part that reads it.
//
// The trade is explicit. A generative model would invent better search phrases than a fixed list, and
// it would also invent them slightly differently every run, silently change what the tool is looking
// for, and require you to trust a process you cannot inspect. A lexicon is dumber and auditable --
// which, for a tool meant to run unattended for months and be handed to a colleague, is the property
// that matters.
//
// The division of labour with the decision model: the lexicon builds the QUERIES (what to fetch), and
// the decision model judges the SUBJECTS (what came back). Neither does the other's job.

import { readFileSync } from 'node:fs'

/**
 * Load and check a topic configuration.
 *
 * @param {string} path
 * @returns {{lexicon: Array, profile: string|null, name: string|null}}
 */
export function loadTopics(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const lexicon = Array.isArray(parsed) ? parsed : parsed.topics
  if (!Array.isArray(lexicon) || lexicon.length === 0) {
    throw new Error(`${path}: expected a "topics" array with at least one entry`)
  }
  for (const [index, topic] of lexicon.entries()) {
    const where = `${path}: topics[${index}]`
    if (typeof topic.id !== 'string' || topic.id.trim() === '') throw new Error(`${where} needs an "id"`)
    if (!Array.isArray(topic.patterns) || topic.patterns.length === 0) throw new Error(`${where} (${topic.id}) needs a non-empty "patterns" array`)
    if (typeof topic.query !== 'string' || topic.query.trim() === '') throw new Error(`${where} (${topic.id}) needs a "query"`)
    if (typeof topic.weight !== 'number' || !Number.isFinite(topic.weight)) throw new Error(`${where} (${topic.id}) needs a numeric "weight"`)
  }
  return {
    lexicon,
    profile: typeof parsed.profile === 'string' ? parsed.profile : null,
    name: typeof parsed.name === 'string' ? parsed.name : null,
  }
}

/**
 * Which lexicon entries the document actually talks about, most specific first.
 *
 * The score is `mentions × weight`: a phrase you use forty times matters more than one you use twice,
 * and a rare, precise phrase matters more than a common one. Both halves are guesses you can
 * disagree with — edit the weights.
 *
 * @param {string} text
 * @param {Array} lexicon
 * @returns {Array} topics, each with `hits` and `score`, sorted descending
 */
export function extractTopics(text, lexicon) {
  const haystack = String(text).toLowerCase()
  const found = []
  for (const topic of lexicon) {
    let hits = 0
    for (const pattern of topic.patterns) hits += countOccurrences(haystack, String(pattern).toLowerCase())
    if (hits > 0) found.push({ ...topic, hits, score: hits * topic.weight })
  }
  return found.sort((a, b) => b.score - a.score)
}

/** The lexicon entries themselves, when there is no document to match them against. */
export function topicsFromLexicon(lexicon) {
  return lexicon.map((topic) => ({ ...topic, hits: 0, score: topic.weight })).sort((a, b) => b.score - a.score)
}

/**
 * Candidate arXiv queries, by rule.
 *
 * Two kinds, and they behave very differently:
 *   * `all:"phrase"` -- broad. Finds everything that mentions the phrase, including the other
 *     literatures that own it. Fine for a one-off search, sorted by relevance.
 *   * `abs:A AND abs:B` -- precise. Two of your own terms in the same abstract. This is what a
 *     scheduled scan needs (see the README on date-sorting).
 */
export function buildQueries(topicsArray, { singles = 4, pairs = 2 } = {}) {
  const queries = []
  for (const topic of topicsArray.slice(0, singles)) {
    queries.push({ expr: `all:${topic.query}`, why: `single topic: ${topic.label ?? topic.id}`, precise: false })
  }
  const strong = topicsArray.slice(0, pairs + 1)
  for (const first of strong.slice(0, 1)) {
    for (const second of strong.slice(1)) {
      queries.push({
        expr: `abs:${strip(first.query)} AND abs:${strip(second.query)}`,
        why: `${first.label ?? first.id} together with ${second.label ?? second.id}`,
        precise: true,
      })
    }
  }
  return dedupeByExpr(queries)
}

/** The topic profile that goes into the judged subject: what the questions refer to as the subject's topics. */
export function profileOf(topicsArray, limit = 6) {
  return topicsArray.slice(0, limit)
    .map((topic) => `- ${topic.label ?? topic.id}${topic.hits > 0 ? ` (${topic.hits} mentions)` : ''}`)
    .join('\n')
}

function countOccurrences(haystack, needle) {
  if (needle === '') return 0
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) { count += 1; at = haystack.indexOf(needle, at + needle.length) }
  return count
}

function strip(phrase) { return String(phrase).replace(/^"|"$/g, '') }

function dedupeByExpr(list) {
  const seen = new Set()
  return list.filter((item) => {
    if (seen.has(item.expr)) return false
    seen.add(item.expr)
    return true
  })
}
