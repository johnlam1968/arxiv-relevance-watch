#!/usr/bin/env node
// ARXIV READ -- the second workflow: read a shortlisted paper in depth, against the project's own
// list of open items.
//
// TWO WORKFLOWS, TWO AXIS SOURCES. `arxiv-watch` SCREENS: many papers, abstracts only, a relevance
// score and a gate, cheap enough to run over everything a query returns. `arxiv-read` READS: a
// handful of papers, the FULL TEXT, and a question set derived from the project's open items rather
// than from the field. Screening answers "is this worth my time?"; reading answers "what does this
// paper do for the specific thing I am trying to finish?".
//
// THE SET EVOLVES. The open items are data (`--project`), and each one is both a question and a
// column of the coverage matrix. Closing an item is editing that file; a paper read against a later
// revision is recorded separately, because it answered different questions.
//
// No language model is called here either. Retrieval is the arXiv API and ar5iv; judgement is the
// decision model answering typed questions.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchFullText } from './fulltext.mjs'
import { composeQuestionSet, coverageMatrix, loadProject } from './project.mjs'
import { openReads } from './read-state.mjs'
import { buildWireQuestions, createSystemOne } from './systemone.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')

main().catch((error) => { process.stderr.write(`\nERROR: ${error.message}\n`); process.exit(1) })

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help === true || args.h === true) return printUsage(0)

  const projectPath = args.project ?? join(PACKAGE_ROOT, 'config', 'project-monodromy-defects.json')
  const project = loadProject(projectPath)
  const { specs, coverageIds } = composeQuestionSet(project)
  const revision = args.revision ?? project.revision
  const statePath = args.state ?? join(PACKAGE_ROOT, 'state', 'reads.sqlite')
  const userAgent = process.env.ARXIV_USER_AGENT ?? 'arxiv-read/1.0'
  const apiKey = process.env.SYSTEMONE_API_KEY ?? process.env.OPENROUTER_API_KEY ?? process.env.TYPESAFE_API_KEY ?? ''
  const model = createSystemOne({
    baseUrl: process.env.SYSTEMONE_BASE_URL ?? 'https://openrouter.ai/api',
    apiKey,
    model: process.env.SYSTEMONE_MODEL ?? 'jev-latest',
    timeoutMs: Number(process.env.SYSTEMONE_TIMEOUT_MS ?? 120000),
  })

  mkdirSync(dirname(statePath), { recursive: true })
  const reads = await openReads(statePath)

  // ── the matrix alone, without spending a call ─────────────────────────────────────────────────
  if (args.matrix === true) {
    printMatrix(reads.rows(revision), project, revision)
    printRevisions(reads)
    reads.close()
    return 0
  }

  const ids = collectIds(args)
  if (ids.length === 0) throw new Error('no papers. Pass --papers 2104.09419,2102.11815 or --from-screen <report.json>')
  if (apiKey === '') throw new Error('no decision-service API key. Set OPENROUTER_API_KEY (or SYSTEMONE_API_KEY).')

  process.stdout.write(`project: ${project.name}  (revision ${revision})\n`)
  process.stdout.write(`open items: ${project.openItems.length}   additional questions: ${project.extraQuestions.length}\n`)
  process.stdout.write(`reading ${ids.length} paper(s), full text, ${specs.length} questions each\n\n`)

  let degradedCount = 0
  for (const [index, id] of ids.entries()) {
    const label = `[${index + 1}/${ids.length}] ${id}`
    let full
    try {
      full = await fetchFullText(id, { userAgent })
    } catch (error) {
      process.stdout.write(`${label}  FETCH FAILED: ${error.message}\n`)
      continue
    }
    if (full.degraded) {
      degradedCount += 1
      process.stdout.write(`${label}  WARNING full text unavailable -- ${full.note}\n`)
      if (args['require-fulltext'] === true) {
        process.stdout.write(`${label}  skipped (--require-fulltext)\n`)
        continue
      }
    }

    const state = buildState(project, id, full)
    let reply
    try {
      reply = await model.evaluate(state, buildWireQuestions(specs))
    } catch (error) {
      process.stdout.write(`${label}  MODEL FAILED: ${error.message}\n`)
      continue
    }
    if (reply === null) { process.stdout.write(`${label}  unreadable reply\n`); continue }

    const answers = {}
    for (const spec of specs) {
      const answer = reply.answers[spec.id]
      if (answer) answers[spec.id] = { ...answer, coverage: spec.coverage === true }
    }
    reads.record({ id, title: full.title ?? null, source: full.source, chars: full.chars, degraded: full.degraded, note: full.note }, answers, revision)

    const covered = coverageIds.filter((q) => (answers[q]?.probability ?? 0) >= 0.5)
    process.stdout.write(`${label}  ${full.source} ${full.chars} chars  |  ${covered.length}/${coverageIds.length} open items addressed\n`)
  }

  const rows = reads.rows(revision)
  printMatrix(rows, project, revision)
  const matrix = coverageMatrix(rows, project.openItems)
  if (matrix.uncovered.length > 0) {
    process.stdout.write(`\nstill uncovered by every paper read: ${matrix.uncovered.map((c) => c.label).join(', ')}\n`)
  }
  printRevisions(reads)

  const reportDir = args.reports ?? join(PACKAGE_ROOT, 'reports')
  mkdirSync(reportDir, { recursive: true })
  const stem = slug(`${project.name}-reading-${revision}`)
  const jsonPath = join(reportDir, `${stem}.json`)
  writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    project: { name: project.name, config: projectPath, revision, openItems: project.openItems },
    llmFree: 'no chat or completion model was called; judgement is the decision model',
    papersRead: rows.length,
    degradedReads: rows.filter((r) => r.degraded).length,
    matrix: matrix.columns,
    uncovered: matrix.uncovered.map((c) => c.id),
    rows,
  }, null, 2) + '\n')
  process.stdout.write(`\nwrote ${jsonPath}\n`)
  if (degradedCount > 0) {
    process.stdout.write(`\n${degradedCount} of ${ids.length} paper(s) were read WITHOUT full text. Those rows answer\n`)
    process.stdout.write('coverage questions about a document that mostly cannot answer them -- do not read a low\n')
    process.stdout.write('probability there as a fact about the paper.\n')
  }
  reads.close()
  return 0
}

/** The state a paper is judged in: the project's purpose, its open items, and the paper's full text. */
function buildState(project, id, full) {
  return [
    `PROJECT (what this reading is for):`,
    project.context,
    '',
    'OPEN ITEMS -- each question below asks whether PAPER addresses one of these:',
    ...project.openItems.map((item) => `- ${item.label}`),
    '',
    'PAPER:',
    `arXiv: ${id}`,
    `Full text source: ${full.source}${full.degraded ? ' (DEGRADED -- see the note below)' : ''}`,
    ...(full.note ? [`NOTE: ${full.note}`] : []),
    '',
    'FULL TEXT:',
    full.text,
    '',
    'REMINDER: the text above was converted from HTML and its MATHEMATICS IS PARTLY GARBLED. Answer from',
    'the prose. If a question turns on an equation you cannot read, say so with the abstain option.',
  ].join('\n')
}

function printMatrix(rows, project, revision) {
  if (rows.length === 0) {
    process.stdout.write(`\nno papers read at revision ${revision} yet\n`)
    return
  }
  const matrix = coverageMatrix(rows, project.openItems)
  process.stdout.write(`\n${'='.repeat(96)}\nCOVERAGE MATRIX -- revision ${revision}, ${matrix.papers} paper(s) x ${matrix.items} open item(s)\n${'='.repeat(96)}\n`)
  process.stdout.write('open item'.padEnd(34) + 'best'.padStart(6) + '  best paper\n')
  for (const column of matrix.columns) {
    const best = column.best
    const shown = column.bestValue === null ? '  -  ' : column.bestValue.toFixed(2)
    const who = best === null ? '(nothing read answers it)' : `${best.paperId}  ${(best.title ?? '').slice(0, 34)}`
    process.stdout.write(`${column.label.slice(0, 33).padEnd(34)}${shown.padStart(6)}  ${who}\n`)
  }
  const addressed = matrix.columns.filter((c) => (c.bestValue ?? 0) >= 0.5).length
  process.stdout.write(`\n${addressed}/${matrix.items} open item(s) addressed by at least one paper\n`)
}

function printRevisions(reads) {
  const revisions = reads.revisions()
  if (revisions.length <= 1) return
  process.stdout.write('\nreading history:\n')
  for (const row of revisions) process.stdout.write(`  ${row.revision}: ${row.papers} paper(s), last ${new Date(row.last_read).toISOString()}\n`)
}

/**
 * Where the papers come from.
 *
 * `--from-screen` is the handoff between the two workflows: it reads a screening report and takes the
 * papers that cleared both gates. That is the whole pipeline -- screen everything, read the survivors.
 */
function collectIds(args) {
  if (typeof args.papers === 'string') return args.papers.split(',').map((s) => s.trim()).filter(Boolean)
  if (typeof args['from-screen'] === 'string') {
    const path = args['from-screen']
    if (!existsSync(path)) throw new Error(`no such screening report: ${path}`)
    const report = JSON.parse(readFileSync(path, 'utf8'))
    const selected = report.selected ?? report.newSelected ?? []
    if (selected.length === 0) throw new Error(`${path}: the screening report selected no papers`)
    return selected.map((p) => String(p.shortId ?? p.url ?? '').split('/abs/').pop().replace(/v\d+$/, '')).filter(Boolean)
  }
  return []
}

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

function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'reading' }

function printUsage(code) {
  process.stdout.write(`arxiv-read — read a shortlisted paper against a project's open items

USAGE
  arxiv-read --from-screen reports/my-topic.json      # read everything screening selected
  arxiv-read --papers 2104.09419,2102.11815           # read specific papers
  arxiv-read --matrix                                 # show what has been read; call no model
  arxiv-read --help

THE TWO WORKFLOWS
  arxiv-watch   screens many papers on their ABSTRACTS and hands you a shortlist
  arxiv-read    reads those papers in FULL TEXT against the project's own open items

  The reading question set is DERIVED from --project, so it evolves as open items close.

OPTIONS
  --project <path>     the project spec: context + open items + extra questions
                       (default: config/project-monodromy-defects.json)
  --papers <ids>       comma-separated arXiv ids
  --from-screen <path> take the papers a screening report selected (the handoff)
  --revision <name>    the set revision to record reads against (default: the project's own)
  --state <path>       SQLite for the reading matrix (default: state/reads.sqlite)
  --reports <dir>      where the matrix report goes (default: reports/)
  --matrix             print the matrix from state and exit; no model is called
  --require-fulltext   skip a paper whose full text could not be fetched, rather than reading its abstract

ENVIRONMENT
  OPENROUTER_API_KEY   the decision-service key (or SYSTEMONE_API_KEY / TYPESAFE_API_KEY)
  ARXIV_USER_AGENT     arXiv asks for a contact address
`)
  return code
}
