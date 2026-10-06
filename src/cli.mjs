#!/usr/bin/env node
// ARXIV RELEVANCE WATCH -- find the arXiv papers that matter to one specific research topic, and
// keep finding them on a schedule.
//
// NO LANGUAGE MODEL IS CALLED, ANYWHERE. The two jobs a chat model would normally do are split and
// both are done without one:
//
//   * WHAT TO SEARCH FOR is a file you write. `config/topics-*.json` holds the vocabulary of your
//     topic, and search queries are assembled from it by rule. Auditable, editable, and identical
//     every run.
//   * WHICH PAPERS MATTER is the decision model's answer to a fixed question set
//     (`config/questions-*.json`). That is a probability model over options you offered -- not a
//     generative model, and not something that can write you a summary you did not ask for.
//
// The tool reports LINKS AND PROBABILITIES. It does not summarise papers, and it will not tell you
// what to think about them.
//
// Run `arxiv-watch --help` for the options.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARXIV_MIN_INTERVAL_MS, searchArxiv, withDateRange } from './arxiv.mjs'
import { openState } from './state.mjs'
import { buildWireQuestions, createSystemOne, choice } from './systemone.mjs'
import { buildQueries, extractTopics, loadTopics, profileOf, topicsFromLexicon } from './topics.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')

// ── defaults, all overridable ───────────────────────────────────────────────────────────────────

const DEFAULTS = {
  topics: join(PACKAGE_ROOT, 'config', 'topics-monodromy-defects.json'),
  questions: join(PACKAGE_ROOT, 'config', 'questions-paper-relevance.json'),
  state: join(PACKAGE_ROOT, 'state', 'seen.sqlite'),
  reports: join(PACKAGE_ROOT, 'reports'),
  max: 25,
  extraQueries: 1,
  threshold: 0.5,
  onTopicThreshold: 0.5,
}

const SYSTEMONE_BASE_URL = process.env.SYSTEMONE_BASE_URL ?? 'https://openrouter.ai/api'
const SYSTEMONE_MODEL = process.env.SYSTEMONE_MODEL ?? 'jev-latest'
const SYSTEMONE_TIMEOUT_MS = Number(process.env.SYSTEMONE_TIMEOUT_MS ?? 60000)
const API_KEY = process.env.SYSTEMONE_API_KEY ?? process.env.OPENROUTER_API_KEY ?? process.env.TYPESAFE_API_KEY ?? ''

// The ten minutes of overlap on a watch window's lower bound. Your clock and arXiv's are not the same
// clock; a repeat costs nothing (the diff removes it) and a missed paper costs the point.
const SINCE_OVERLAP_MS = 10 * 60 * 1000

main().catch((error) => {
  process.stderr.write(`\nERROR: ${error.message}\n`)
  process.exit(1)
})

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help === true || args.h === true) return printUsage(0)

  const watch = args.watch === true
  const showAll = args.all === true
  const dryRun = args['dry-run'] === true
  const skipModelQuery = args['no-model-query'] === true
  const sort = args.sort ?? (watch ? 'submittedDate' : 'relevance')
  if (!['relevance', 'submittedDate'].includes(sort)) throw new Error(`--sort must be relevance or submittedDate, got ${JSON.stringify(sort)}`)

  const userAgent = process.env.ARXIV_USER_AGENT ?? 'arxiv-relevance-watch/1.0'
  if (!/mailto:|@/.test(userAgent)) {
    process.stderr.write(
      'NOTE: arXiv asks every client to identify itself with a contact address.\n'
      + '      Set one with:  ARXIV_USER_AGENT="arxiv-relevance-watch/1.0 (mailto:you@example.edu)"\n\n')
  }

  // ── what are we looking for? ──────────────────────────────────────────────────────────────────
  const topicsPath = args.topics ?? DEFAULTS.topics
  const { lexicon, profile: configProfile, name } = loadTopics(topicsPath)
  const textPath = args.text
  const topics = textPath === undefined
    ? topicsFromLexicon(lexicon)
    : extractTopics(readFileSync(textPath, 'utf8'), lexicon)
  if (topics.length === 0) throw new Error(`none of the ${lexicon.length} lexicon entries appear in ${textPath}`)

  const topicProfile = textPath === undefined
    ? (configProfile ?? profileOf(topics))
    : profileOf(topics)

  process.stdout.write(`topic: ${name ?? topicsPath}\n`)
  if (textPath !== undefined) process.stdout.write(`document: ${textPath}\n`)
  process.stdout.write(`\ntopics (lexicon match x specificity):\n`)
  for (const topic of topics.slice(0, 10)) {
    process.stdout.write(`  ${String(topic.score).padStart(4)}  ${(topic.label ?? topic.id).padEnd(28)} x${topic.hits}  ->  ${topic.query}\n`)
  }

  // ── what will we search for? ──────────────────────────────────────────────────────────────────
  const candidates = buildQueries(topics)
  process.stdout.write(`\ncandidate queries:\n`)
  candidates.forEach((q, i) => process.stdout.write(`  [${i}] ${q.expr}   (${q.why})\n`))

  const questionsPath = args.questions ?? DEFAULTS.questions
  const specs = JSON.parse(readFileSync(questionsPath, 'utf8'))
  const wireQuestions = buildWireQuestions(specs)
  const model = createSystemOne({ baseUrl: SYSTEMONE_BASE_URL, apiKey: API_KEY, model: SYSTEMONE_MODEL, timeoutMs: SYSTEMONE_TIMEOUT_MS })

  // The model picks which query to run. This is the one place a judgement is asked of it rather than
  // of a rule, and its pick is ADDED to the rule-built queries, never substituted for them -- so a
  // bad pick cannot lose the deterministic results.
  let picked = null
  if (!dryRun && !skipModelQuery && API_KEY !== '') {
    picked = await pickQuery({ model, candidates, topicProfile })
  }

  const pool = watch && candidates.some((q) => q.precise) ? candidates.filter((q) => q.precise) : candidates
  const toRun = dedupeQueries([...(picked === null ? [] : [picked]), ...pool.slice(0, 1 + Number(args['extra-queries'] ?? DEFAULTS.extraQueries))])

  // ── the state, opened before the search: the last run's time bounds it ────────────────────────
  let state = null
  let knownIds = new Set()
  let runId = null
  let lastRunAt = null
  if (watch) {
    const statePath = args.state ?? DEFAULTS.state
    mkdirSync(dirname(statePath), { recursive: true })
    state = await openState(statePath)
    knownIds = state.knownIds()
    lastRunAt = state.lastRunAt()
    runId = state.startRun(toRun.map((q) => q.expr))
    process.stdout.write(`\nstate: ${statePath}\n  ${state.stats().papers} paper(s) on record; last run ${lastRunAt === null ? 'never' : new Date(lastRunAt).toISOString()}\n`)
  }

  // ── fetch ─────────────────────────────────────────────────────────────────────────────────────
  process.stdout.write(`\nquerying arXiv (${toRun.length} request(s), ${ARXIV_MIN_INTERVAL_MS} ms apart, sort=${sort}):\n`)
  const papers = new Map()
  let lastCall = 0
  for (const query of toRun) {
    const wait = ARXIV_MIN_INTERVAL_MS - (Date.now() - lastCall)
    if (wait > 0) await sleep(wait)
    lastCall = Date.now()
    const expr = watch && lastRunAt !== null ? withDateRange(query.expr, lastRunAt - SINCE_OVERLAP_MS, Date.now()) : query.expr
    let found
    try {
      found = await searchArxiv({ expr, max: Number(args.max ?? DEFAULTS.max), sortBy: sort, userAgent })
    } catch (error) {
      process.stdout.write(`  ${expr}  ->  FAILED: ${error.message}\n`)
      continue
    }
    let added = 0
    for (const paper of found) if (!papers.has(paper.id)) { papers.set(paper.id, paper); added += 1 }
    const unseen = state === null ? added : found.filter((paper) => !knownIds.has(paper.id)).length
    process.stdout.write(`  ${expr}  ->  ${found.length} returned, ${added} new to this run${state === null ? '' : `, ${unseen} never seen before`}\n`)
  }
  const all = [...papers.values()]
  process.stdout.write(`\n${all.length} unique paper(s) retrieved\n`)

  if (dryRun) {
    for (const paper of all) process.stdout.write(`  ${paper.published.slice(0, 10)}  ${shortId(paper)}  ${paper.title}\n`)
    process.stdout.write('\n--dry-run: no model was called, so no relevance scores were produced.\n')
    if (state !== null) state.close()
    return 0
  }
  if (API_KEY === '') {
    throw new Error(
      'no decision-service API key.\n'
      + '  Set OPENROUTER_API_KEY (or SYSTEMONE_API_KEY) and try again.\n'
      + '  This tool cannot rank papers without a decision model.')
  }

  // ── judge ─────────────────────────────────────────────────────────────────────────────────────
  const scoreLevels = (specs.find((s) => s.id === 'paper_topic_overlap')?.levels ?? []).length - 1
  process.stdout.write(`\nquestion set: ${questionsPath}\nscoring ${all.length} paper(s) with ${SYSTEMONE_MODEL}...\n`)

  const scored = []
  let usage = { input_tokens: 0, output_tokens: 0, cost: 0 }
  for (const [index, paper] of all.entries()) {
    let reply
    try {
      reply = await model.evaluate(buildPaperState(paper, topicProfile), wireQuestions)
    } catch (error) {
      process.stdout.write(`  [${index + 1}/${all.length}] FAILED ${shortId(paper)}: ${error.message}\n`)
      continue
    }
    if (reply === null) { process.stdout.write(`  [${index + 1}/${all.length}] unreadable reply for ${shortId(paper)}\n`); continue }
    usage = addUsage(usage, reply.usage)
    const overlap = reply.answers.paper_topic_overlap
    const onTopic = reply.answers.paper_on_topic
    // A narrowed SCORE carries `level` -- the expected position over the ordered criteria, which is
    // the scalar this ranking needs. (`score` is the wire's name for it, and reading that name here
    // returned `null` for every paper.)
    const level = typeof overlap?.level === 'number' ? overlap.level : null
    const rank = level === null || scoreLevels <= 0 ? null : level / scoreLevels
    scored.push({
      id: paper.id,
      shortId: shortId(paper),
      title: paper.title,
      url: paper.id,
      published: paper.published,
      categories: paper.categories,
      rank,
      answers: Object.fromEntries(Object.entries(reply.answers).map(([k, v]) => [k, slim(v)])),
    })
    process.stdout.write(`  [${index + 1}/${all.length}] rank ${rank === null ? '?' : rank.toFixed(2)}  ${fmt(onTopic?.probability)} on-topic  ${paper.title.slice(0, 60)}\n`)
  }

  // ── rank, gate, report ────────────────────────────────────────────────────────────────────────
  const onTopicOf = (paper) => paper.answers.paper_on_topic?.probability ?? null
  const threshold = Number(args.threshold ?? DEFAULTS.threshold)
  const onTopicThreshold = Number(args['on-topic-threshold'] ?? DEFAULTS.onTopicThreshold)
  const passes = (paper) => paper.rank !== null && paper.rank >= threshold && (onTopicOf(paper) ?? 0) >= onTopicThreshold
  const selected = scored.filter(passes).sort((a, b) => b.rank - a.rank || (onTopicOf(b) ?? 0) - (onTopicOf(a) ?? 0))
  // A paper that cleared the score but not the gate is REPORTED. A gate that silently removes things
  // is the failure this whole design is arranged to avoid.
  const gatedOut = scored.filter((paper) => paper.rank !== null && paper.rank >= threshold && !passes(paper))

  const newPapers = state === null ? [] : scored.filter((paper) => !knownIds.has(paper.id))
  const newSelected = newPapers.filter(passes)
  const output = state !== null && !showAll ? newSelected : selected

  process.stdout.write(`\n${'='.repeat(96)}\n`)
  process.stdout.write(state !== null
    ? `NEW SINCE ${lastRunAt === null ? 'the beginning' : new Date(lastRunAt).toISOString()}: ${newSelected.length} worth reading (${newPapers.length} new paper(s) seen, ${scored.length} scored)\n`
    : `WORTH READING (rank >= ${threshold} AND on-topic >= ${onTopicThreshold}): ${selected.length} of ${scored.length} scored\n`)
  process.stdout.write(`${'='.repeat(96)}\n`)
  for (const paper of output) {
    process.stdout.write(`${paper.rank.toFixed(2)}  ${paper.url}\n      ${paper.title}\n`)
    process.stdout.write(`      ${paper.published.slice(0, 10)} | ${paper.categories.join(' ')} | on-topic ${fmt(onTopicOf(paper))} | open-problem ${fmt(paper.answers.paper_answers_open_problem?.probability)} | read ${fmt(paper.answers.paper_worth_reading?.probability)} | ${paper.answers.paper_relation?.label ?? '?'}\n`)
  }
  if (output.length === 0) {
    process.stdout.write(state !== null
      ? '(no new paper cleared both gates -- this is the normal outcome of a scheduled run)\n'
      : '(nothing cleared both gates -- lower them with --threshold / --on-topic-threshold)\n')
  }
  if (gatedOut.length > 0) {
    process.stdout.write(`\ncleared the score but failed the on-topic gate (${gatedOut.length}):\n`)
    for (const paper of gatedOut) process.stdout.write(`  ${paper.rank.toFixed(2)} rank / ${fmt(onTopicOf(paper))} on-topic  ${paper.url}  ${paper.title.slice(0, 56)}\n`)
  }

  // ── write the report ──────────────────────────────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    topic: { name: name ?? null, config: topicsPath, document: textPath ?? null, profile: topicProfile, topics: topics.slice(0, 10) },
    model: { endpoint: model.endpoint, requested: SYSTEMONE_MODEL },
    llmFree: 'no chat or completion model was called: topics are lexicon-matched, judgement is the decision model',
    questions: questionsPath,
    queries: toRun.map((q) => q.expr),
    modelPickedQuery: picked?.expr ?? null,
    thresholds: { rank: threshold, onTopic: onTopicThreshold },
    usage,
    scored: scored.length,
    watch: state === null ? null : {
      previousRunAt: lastRunAt === null ? null : new Date(lastRunAt).toISOString(),
      knownBefore: knownIds.size,
      newPapers: newPapers.length,
      newSelected: newSelected.length,
      sort,
    },
    selected,
    newSelected: state === null ? undefined : newSelected,
    gatedOut: gatedOut.map((paper) => ({ url: paper.url, title: paper.title, rank: paper.rank, onTopic: onTopicOf(paper), relation: paper.answers.paper_relation?.label ?? null })),
    belowThreshold: scored.filter((paper) => paper.rank === null || paper.rank < threshold).map((paper) => ({ url: paper.url, title: paper.title, rank: paper.rank, onTopic: onTopicOf(paper) })),
  }
  const reportDir = args.reports ?? DEFAULTS.reports
  mkdirSync(reportDir, { recursive: true })
  const stem = args.name ?? slug(name ?? 'topic')
  const jsonPath = join(reportDir, `${stem}.json`)
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(reportDir, `${stem}.md`), renderMarkdown(report))
  process.stdout.write(`\nwrote ${jsonPath}\n      ${join(reportDir, `${stem}.md`)}\n`)
  process.stdout.write(`usage: ${usage.input_tokens} in / ${usage.output_tokens} out  ~$${usage.cost.toFixed(6)}\n`)

  // ── remember ──────────────────────────────────────────────────────────────────────────────────
  if (state !== null) {
    for (const paper of scored) {
      state.record({
        id: paper.id,
        title: paper.title,
        url: paper.url,
        rank: paper.rank,
        onTopic: onTopicOf(paper),
        relation: paper.answers.paper_relation?.label ?? null,
        selected: passes(paper),
      })
    }
    state.finishRun(runId, {
      scored: scored.length,
      newPapers: newPapers.length,
      newSelected: newSelected.length,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost: usage.cost,
    })
    process.stdout.write(`state: ${state.stats().papers} paper(s) on record now (${newPapers.length} added this run)\n`)
    state.close()
  }
  return 0
}

/** Ask the decision model which candidate query to run. Returns null rather than throwing. */
async function pickQuery({ model, candidates, topicProfile }) {
  const instructions = 'The TOPIC PROFILE below describes a research subject. Which arXiv query is most likely to retrieve papers that address it? Judge the QUERY STRING, not a paper.'
  const options = candidates.map((q, i) => ({ label: `q${i}`, criterion: q.expr }))
  // Exactly one abstain option is required, and it is a fact about the QUESTION rather than about the
  // candidate list -- so it is appended here instead of being one of the queries.
  options.push({ label: 'no_preference', criterion: 'none of these stands out', abstain: true })
  const state = `TOPIC PROFILE:\n${topicProfile}\n\nCANDIDATE QUERIES:\n${candidates.map((q, i) => `q${i}: ${q.expr}`).join('\n')}`
  let reply
  try {
    reply = await model.evaluate(state, { query_preference: choice(instructions, options) })
  } catch (error) {
    process.stdout.write(`\nmodel query pick failed (${error.message}); using the rules alone\n`)
    return null
  }
  const answer = reply?.answers?.query_preference
  if (answer?.type !== 'choice' || !/^q\d+$/.test(answer.label ?? '')) {
    process.stdout.write(`\nmodel query pick unusable (${answer?.reason ?? answer?.type ?? 'no answer'}); using the rules alone\n`)
    return null
  }
  process.stdout.write(`\nmodel picked: ${candidates[Number(answer.label.slice(1))].expr}  (confidence ${fmt(answer.answerConfidence ?? answer.confidence)})\n`)
  if (answer.invalid === true) process.stdout.write(`  NOTE: the reader marked this answer invalid -- ${answer.invalidReason}\n`)
  return candidates[Number(answer.label.slice(1))]
}

/** The subject a paper is judged in: its own record, beside the topic profile the questions refer to. */
function buildPaperState(paper, topicProfile) {
  return [
    'TOPIC PROFILE (what this search is about; PAPER is judged only against this):',
    topicProfile,
    '',
    'PAPER:',
    `Title: ${paper.title}`,
    `Authors: ${paper.authors.slice(0, 6).join(', ')}${paper.authors.length > 6 ? ', et al.' : ''}`,
    `Published: ${paper.published.slice(0, 10)}`,
    `Categories: ${paper.categories.join(', ')}`,
    `arXiv: ${paper.id}`,
    '',
    `Abstract: ${paper.abstract}`,
  ].join('\n')
}

function renderMarkdown(report) {
  const lines = [
    `# arXiv relevance — ${report.topic.name ?? 'topic'}`,
    '',
    `Generated ${report.generatedAt}  ·  model \`${report.model.requested}\` via \`${report.model.endpoint}\``,
    '',
    `**LLM-free:** ${report.llmFree}.`,
    '',
    ...(report.watch
      ? [`**Watch run** · sort \`${report.watch.sort}\` · previous run ${report.watch.previousRunAt ?? 'never'} · ${report.watch.knownBefore} paper(s) already known · **${report.watch.newSelected} new worth reading** of ${report.watch.newPapers} new seen`, '']
      : []),
    '## Topics',
    '',
    ...(report.topic.document === null
      ? ['No document was supplied (`--text`), so the profile is the one written in the config and every lexicon entry below is used. `mentions` therefore does not apply.', '']
      : [`Topics are ranked by \`mentions x weight\` over \`${report.topic.document}\`.`, '']),
    '| topic | mentions | weight | score |',
    '|---|---|---|---|',
    ...report.topic.topics.map((t) => `| ${t.label ?? t.id} | ${t.hits > 0 ? t.hits : '—'} | ${t.weight} | ${t.score} |`),
    '',
    '## Queries run',
    '',
    ...report.queries.map((q) => `- \`${q}\``),
    '',
    report.modelPickedQuery ? `The model chose \`${report.modelPickedQuery}\`; the rest were built by rule.` : 'Query selection: rules only.',
    '',
    `## Worth reading (rank ≥ ${report.thresholds.rank} AND on-topic ≥ ${report.thresholds.onTopic})`,
    '',
    '| rank | on-topic | paper | why |',
    '|---|---|---|---|',
    ...report.selected.map((p) => `| ${p.rank.toFixed(2)} | ${fmt(p.answers.paper_on_topic?.probability)} | [${p.title}](${p.url})<br>${p.shortId} · ${p.published.slice(0, 10)} | open-problem ${fmt(p.answers.paper_answers_open_problem?.probability)} · read ${fmt(p.answers.paper_worth_reading?.probability)} · ${p.answers.paper_relation?.label ?? '?'} |`),
    '',
    ...(report.gatedOut.length > 0
      ? [`## Cleared the score but failed the on-topic gate (${report.gatedOut.length})`, '',
         ...report.gatedOut.map((p) => `- ${p.rank.toFixed(2)} rank / ${fmt(p.onTopic)} on-topic — [${p.title}](${p.url}) (${p.relation ?? '?'})`), '']
      : []),
    `## Below the score threshold (${report.belowThreshold.length})`,
    '',
    ...report.belowThreshold.map((p) => `- ${p.rank === null ? 'n/a' : p.rank.toFixed(2)} — [${p.title}](${p.url})`),
    '',
  ]
  return lines.join('\n')
}

// ── small helpers ───────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i += 1 }
  }
  return out
}

function printUsage(code) {
  process.stdout.write(`arxiv-watch — rank arXiv papers by relevance to one research topic, with a decision model

USAGE
  arxiv-watch [options]

WHAT IT NEEDS
  A topic config  (--topics)     the vocabulary of your subject, and the queries built from it
  A question set  (--questions)  how a paper is judged
  An API key                     OPENROUTER_API_KEY, or SYSTEMONE_API_KEY

COMMON OPTIONS
  --topics <path>          topic config            (default: config/topics-monodromy-defects.json)
  --text <path>            a document to match the lexicon against; without it, every lexicon entry is used
  --questions <path>       question set            (default: config/questions-paper-relevance.json)
  --max <n>                results per query       (default: 25)
  --threshold <p>          minimum overlap score   (default: 0.5)
  --on-topic-threshold <p> minimum on-topic gate   (default: 0.5)
  --dry-run                search only; call no model
  --help                   this text

SCHEDULED SCANNING
  --watch                  report only papers never seen before
  --state <path>           the SQLite state file   (default: state/seen.sqlite)
  --all                    with --watch, print everything, not only the new ones
  --sort <relevance|submittedDate>   (default: submittedDate under --watch, else relevance)
  --extra-queries <n>      rule-built queries beside the model's pick (default: 1)

OUTPUT
  --reports <dir>          where the .json and .md reports go (default: reports/)
  --name <stem>            report file stem       (default: slug of the topic name)

ENVIRONMENT
  OPENROUTER_API_KEY       the decision-service key (or SYSTEMONE_API_KEY / TYPESAFE_API_KEY)
  SYSTEMONE_BASE_URL       default https://openrouter.ai/api
  SYSTEMONE_MODEL          default jev-latest
  ARXIV_USER_AGENT         arXiv asks for a contact address, e.g. "arxiv-watch/1.0 (mailto:you@example.edu)"

EXAMPLES
  arxiv-watch --dry-run                       # see what the queries find, spend nothing
  arxiv-watch                                 # score everything and print the ranked links
  arxiv-watch --watch --max 20                # what a nightly cron job should run
  arxiv-watch --text ~/notes/my-notes.md      # match the lexicon against your own document
`)
  return code
}

function shortId(paper) { return paper.id.split('/abs/').pop() }
function fmt(value) { return typeof value === 'number' ? value.toFixed(2) : '?' }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'topic' }

function dedupeQueries(list) {
  const seen = new Set()
  return list.filter((item) => (seen.has(item.expr) ? false : (seen.add(item.expr), true)))
}

function slim(answer) {
  if (!answer || typeof answer !== 'object') return answer
  const { type, probability, score, level, label, confidence, answerConfidence, invalid, invalidReason, reason } = answer
  return { type, probability, score, level, label, confidence, answerConfidence, invalid, invalidReason, reason }
}

function addUsage(total, usage) {
  if (!usage || typeof usage !== 'object') return total
  return {
    input_tokens: total.input_tokens + (usage.input_tokens ?? 0),
    output_tokens: total.output_tokens + (usage.output_tokens ?? 0),
    cost: total.cost + (usage.cost ?? 0),
  }
}
