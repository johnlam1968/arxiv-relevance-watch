// FULL TEXT, for the second workflow.
//
// The screening workflow reads ABSTRACTS on purpose: it must be cheap enough to run over everything a
// query returns. The reading workflow is the opposite -- a handful of papers, and its questions are
// about what a paper actually does, which an abstract usually does not say.
//
// WHICH IS WHY A DEGRADED FETCH IS REPORTED AND NOT HIDDEN. If only the abstract is available, a
// coverage question ("does this paper give the flat-space energy per unit length?") is being asked of
// a document that mostly cannot answer it, and a confident low probability would read as a finding
// about the paper when it is a fact about the fetch. So `degraded` is returned, printed, and recorded.

export const AR5IV_BASE = 'https://ar5iv.labs.arxiv.org/html'
export const ARXIV_ABS_BASE = 'https://arxiv.org/abs'

/**
 * Fetch a paper's full text, falling back to its abstract with an explicit `degraded` flag.
 *
 * @param {string} arxivId        base id, no version (`2104.09419`)
 * @param {object} options
 * @returns {Promise<{text: string, source: string, chars: number, degraded: boolean, note: string|null}>}
 */
export async function fetchFullText(arxivId, { userAgent, timeoutMs = 60000 } = {}) {
  const id = String(arxivId).replace(/v\d+$/, '')
  const headers = { 'user-agent': userAgent }

  // ar5iv renders arXiv papers as HTML. Not every paper has one, and the render is absent rather than
  // an error when it does not, so a 200 with no article body is a miss like any other.
  try {
    const response = await fetch(`${AR5IV_BASE}/${id}`, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (response.ok) {
      const body = await response.text()
      const prose = htmlToProse(body)
      if (prose.chars >= 4000) {
        return { text: prose.text, source: 'ar5iv', chars: prose.chars, degraded: false, note: null }
      }
      if (prose.chars > 0) {
        return {
          text: prose.text, source: 'ar5iv', chars: prose.chars, degraded: true,
          note: `ar5iv returned only ${prose.chars} characters of prose -- probably a render failure, not a short paper`,
        }
      }
    }
  } catch (error) {
    // fall through to the abstract; the note below records why
    var ar5ivError = error instanceof Error ? error.message : String(error)
  }

  const abstract = await arxivAbstract(id, { userAgent, timeoutMs })
  return {
    text: abstract.text, source: 'abstract', chars: abstract.text.length, degraded: true,
    note: ar5ivError !== undefined
      ? `no ar5iv HTML (${ar5ivError}); only the abstract is available`
      : 'no ar5iv HTML; only the abstract is available',
  }
}

async function arxivAbstract(id, { userAgent, timeoutMs }) {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`,
    { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`arXiv answered ${response.status}`)
  const { parseAtom } = await import('./arxiv.mjs')
  const [paper] = parseAtom(await response.text())
  if (paper === undefined) throw new Error(`arXiv returned no entry for ${id}`)
  return {
    text: `Title: ${paper.title}\n\nAbstract: ${paper.abstract}`,
    title: paper.title,
    authors: paper.authors,
    published: paper.published,
    categories: paper.categories,
  }
}

/**
 * ar5iv's HTML reduced to the prose a judge can use.
 *
 * The mathematics is the problem. ar5iv renders formulas as MathML or as image alt-text, and when it
 * falls back the symbols come through as private-use characters (`ﬃ` for delta, `œ` for sigma). The
 * substitutions below are the ones identified by hand on a real paper; they are a HEURISTIC and they
 * are lossy. What this function promises is prose, not formulas -- and the state built from it says
 * so, so the judge knows not to answer a question that turns on an equation.
 *
 * @param {string} html
 * @returns {{text: string, chars: number, dropped: number}}
 */
export function htmlToProse(html) {
  let text = String(html)
  text = text.replace(/<(script|style|nav|footer|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  text = text.replace(/<(h[1-6])[^>]*>/gi, '\n\n### ')
  text = text.replace(/<(p|div|li|br|tr|section)[^>]*>/gi, '\n')
  text = text.replace(/<[^>]+>/g, ' ')
  text = decodeEntities(text)

  for (const [from, to] of AR5IV_SYMBOLS) text = text.split(from).join(to)

  // Ar5iv leaves LaTeX scaffolding behind around the math it could not render.
  text = text.replace(/\^\{\\hbox\{[^}]*\}\}/g, ' ')
  text = text.replace(/\\mathchar\s*\d+/g, ' ')
  text = text.replace(/\\[a-zA-Z]+\b/g, ' ')
  text = text.replace(/[{}]/g, ' ')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n\s*\n+/g, '\n')

  const kept = []
  let dropped = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length < 40) { dropped += 1; continue }
    // A line that is mostly punctuation and digits is equation debris, not a sentence.
    const letters = [...line].filter((c) => /[a-zA-Z\s]/.test(c)).length
    if (letters / line.length < 0.62) { dropped += 1; continue }
    kept.push(line.replace(/\s+/g, ' '))
  }
  const out = kept.join('\n\n')
  return { text: out, chars: out.length, dropped }
}

/** Private-use characters ar5iv emits when its math renderer falls back. Identified by hand. */
const AR5IV_SYMBOLS = Object.freeze([
  ['\uFB03', 'delta'],   // ffi ligature slot used for the flux parameter
  ['\u0153', 'sigma'],
  ['\u00DF', 'pi'],
  ['\u0131', 'zeta'],
])

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}
