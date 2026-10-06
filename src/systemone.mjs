// THE DECISION-MODEL CLIENT.
//
// This is the ONLY model in the tool, and it is not a chat model. It takes a subject (`state`) and a
// set of typed questions and returns a probability per question. It cannot write prose, and it is
// never asked to: retrieval is deterministic and judgement is this.
//
// The reply is read by the vendored `narrow.mjs` rather than by property-poking here, so an answer
// that is *readable but wrong* -- a `choice` answered with a `noul`, a probability vector summing to
// 1.8, a `NaN` that JSON turned into `null` -- is marked rather than trusted. That distinction is
// the reason to reuse the reader instead of writing `body.answers[id].noul`.

import { choice, noul, score } from './vendor/questions.mjs'
import { narrowAnswers } from './vendor/narrow.mjs'

export { narrowAnswers }

/**
 * A client for one decision-service endpoint.
 *
 * @param {object} options
 * @param {string} options.baseUrl   e.g. `https://openrouter.ai/api`
 * @param {string} options.apiKey    sent as `Authorization: Bearer`
 * @param {string} options.model     e.g. `jev-latest`
 * @param {number} [options.timeoutMs]
 */
export function createSystemOne({ baseUrl, apiKey, model, timeoutMs = 60000 }) {
  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/v1/systemone`

  /**
   * Ask one question set about one subject.
   *
   * @param {string} state          the subject text
   * @param {object} questions      wire-format questions, keyed by id
   * @returns {Promise<{answers: object, usage: object|undefined}|null>} `null` when the reply
   *          carried no answers object at all; per-question problems come back inside `answers`
   */
  async function evaluate(state, questions) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`the decision service answered ${response.status}`)
    const body = await response.json()
    const narrowed = narrowAnswers(body, questions)
    if (narrowed.kind === 'error') return null
    return { answers: narrowed.answers, usage: body.usage }
  }

  /** Whether the endpoint answers at all. Cheap, and it fails as `false` rather than throwing. */
  async function health() {
    try {
      const response = await fetch(endpoint.replace(/\/v1\/systemone$/, '/health'), { method: 'GET' })
      return response.ok === true
    } catch {
      return false
    }
  }

  return { evaluate, health, endpoint }
}

/**
 * A question-set FILE's shape -> the decision service's wire shape.
 *
 * The file is written for a person: `levels` for a score, `options` for a choice. The wire wants
 * `criteria` -- an ordered array for a score, a map for a choice -- and the vendored builders are
 * what convert one to the other. They also enforce the shapes the service actually rejects, which is
 * why a malformed set fails here, at load, rather than as an unreadable answer later.
 */
export function buildWireQuestions(specs) {
  if (!Array.isArray(specs)) throw new Error('a question set must be a JSON array of question specs')
  const wire = {}
  for (const spec of specs) {
    if (typeof spec?.id !== 'string' || spec.id.trim() === '') throw new Error('every question needs a non-empty `id`')
    if (Object.hasOwn(wire, spec.id)) throw new Error(`duplicate question id: ${spec.id}`)
    if (spec.type === 'noul') wire[spec.id] = noul(spec.instructions, spec.criteria)
    else if (spec.type === 'score') wire[spec.id] = score(spec.instructions, spec.levels)
    else if (spec.type === 'choice') wire[spec.id] = choice(spec.instructions, spec.options)
    else throw new Error(`question "${spec.id}": unknown type ${JSON.stringify(spec.type)} (expected noul, score or choice)`)
  }
  return wire
}

/** The vendored builders, re-exported so a caller can write a set in code. */
export { choice, noul, score }
