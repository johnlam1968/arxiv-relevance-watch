// THE ARXIV API CLIENT.
//
// One public endpoint, no key, and one hard rule: do not hammer it. arXiv asks callers to identify
// themselves and to leave a few seconds between requests, and it will rate-limit or block a client
// that does not. `searchArxiv` therefore takes the caller's User-Agent rather than inventing one --
// see the README for why it must carry a real contact address.

export const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query'

/** arXiv's documented courtesy interval. The CLI enforces it between requests; this module does not. */
export const ARXIV_MIN_INTERVAL_MS = 3100

/**
 * One query against the arXiv API.
 *
 * @param {object} options
 * @param {string} options.expr        an arXiv search expression, e.g. `abs:"monodromy defect"`
 * @param {number} [options.max]       results to ask for
 * @param {string} [options.sortBy]    `relevance` or `submittedDate`
 * @param {string} options.userAgent   who is asking; arXiv wants a contact address in it
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Array<object>>}   parsed papers
 */
export async function searchArxiv({ expr, max = 25, sortBy = 'relevance', userAgent, timeoutMs = 45000 }) {
  const url = `${ARXIV_ENDPOINT}?search_query=${encodeURIComponent(expr)}`
    + `&start=0&max_results=${max}&sortBy=${sortBy}&sortOrder=descending`
  const response = await fetch(url, {
    headers: { 'user-agent': userAgent },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`arXiv answered ${response.status}`)
  return parseAtom(await response.text())
}

/**
 * The arXiv Atom feed, parsed with regexes.
 *
 * A real XML parser would be the tidier choice, and it is the wrong trade here: the entry fields this
 * tool reads (`id`, `title`, `summary`, `published`, `author/name`, `category@term`) are flat, the
 * feed is machine-generated and stable, and the alternative is a dependency in a tool whose whole
 * install story is "no dependencies". The failure mode is understood: a change to the feed's shape
 * drops fields rather than throwing, which is why `parseAtom` is exercised by a fixture test.
 */
export function parseAtom(xml) {
  const papers = []
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1]
    const id = tagText(entry, 'id')
    if (id === '') continue
    papers.push({
      id,
      title: collapse(tagText(entry, 'title')),
      abstract: collapse(tagText(entry, 'summary')),
      published: tagText(entry, 'published'),
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => collapse(m[1])),
      categories: [...entry.matchAll(/<category\s+term="([^"]+)"/g)].map((m) => m[1]),
    })
  }
  return papers
}

/** arXiv's date-range stamp: `YYYYMMDDHHMM`, UTC. Used inside `submittedDate:[a TO b]`. */
export function arxivStamp(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

/** Narrow an expression to a submission window. Parenthesised, because `A AND B AND date` binds wrongly. */
export function withDateRange(expr, fromMs, toMs) {
  return `(${expr}) AND submittedDate:[${arxivStamp(fromMs)} TO ${arxivStamp(toMs)}]`
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return match ? decodeEntities(match[1]).trim() : ''
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

function collapse(value) { return value.replace(/\s+/g, ' ').trim() }
