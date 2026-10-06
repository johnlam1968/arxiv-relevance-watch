// THE SEEN-STATE for scheduled scanning.
//
// The job is small on purpose: remember which arXiv ids have been looked at, and say which of the
// papers in this run are new. Node's built-in `node:sqlite` is enough -- no dependency, no server,
// one file -- and the whole thing is disposable: deleting the file just means the next run reports
// everything as new.
//
// WHY SQLITE AND NOT A JSON FILE. For a topic this narrow a run touches tens of papers, so a JSON
// file would work. What SQLite buys is not scale, it is an UPSERT: a paper that appears in two
// queries of the same run is one row, and a paper seen again in a later run has its score refreshed
// and its run counter incremented -- without rewriting a whole document, and without the risk of a
// half-written file if the run is interrupted.

// `node:sqlite` IS IMPORTED LAZILY, ON PURPOSE. It is still an experimental module and Node prints a
// warning the moment it loads -- so a static import here meant `--help` and `--dry-run` printed a
// SQLite warning for a database they never touch. Loading it inside `openState` keeps the warning
// attached to the only thing that causes it.
/**
 * Open (creating if absent) the state file and make its schema current.
 * @param {string} path
 */
export async function openState(path) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers (
      id         TEXT PRIMARY KEY,
      first_seen INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      title      TEXT,
      url        TEXT,
      rank       REAL,
      on_topic   REAL,
      relation   TEXT,
      selected   INTEGER NOT NULL DEFAULT 0,
      runs       INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at   INTEGER NOT NULL,
      finished_at  INTEGER,
      queries      TEXT,
      scored       INTEGER,
      new_papers   INTEGER,
      new_selected INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost         REAL
    );
    CREATE INDEX IF NOT EXISTS papers_first_seen ON papers (first_seen);
  `)
  return {
    db,

    /** Every id this state has ever seen. */
    knownIds() {
      return new Set(db.prepare('SELECT id FROM papers').all().map((row) => row.id))
    },

    /** The moment the previous run finished, or null on a first run. */
    lastRunAt() {
      const row = db.prepare('SELECT finished_at FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get()
      return row?.finished_at ?? null
    },

    /** Record or refresh one scored paper. Returns true when the id was not previously known. */
    record(paper) {
      const now = Date.now()
      const isNew = db.prepare('SELECT 1 AS present FROM papers WHERE id = ?').get(paper.id) === undefined
      db.prepare(`
        INSERT INTO papers (id, first_seen, last_seen, title, url, rank, on_topic, relation, selected, runs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          last_seen = excluded.last_seen,
          title     = excluded.title,
          rank      = excluded.rank,
          on_topic  = excluded.on_topic,
          relation  = excluded.relation,
          selected  = excluded.selected,
          runs      = papers.runs + 1
      `).run(paper.id, now, now, paper.title, paper.url, paper.rank, paper.onTopic, paper.relation, paper.selected ? 1 : 0)
      return isNew
    },

    /** Start a run row; returns its id, to be closed with `finishRun`. */
    startRun(queries) {
      const result = db.prepare('INSERT INTO runs (started_at, queries) VALUES (?, ?)').run(Date.now(), JSON.stringify(queries))
      return Number(result.lastInsertRowid)
    },

    finishRun(id, summary) {
      db.prepare(`
        UPDATE runs SET finished_at = ?, scored = ?, new_papers = ?, new_selected = ?,
                        input_tokens = ?, output_tokens = ?, cost = ?
        WHERE id = ?
      `).run(Date.now(), summary.scored, summary.newPapers, summary.newSelected,
        summary.inputTokens, summary.outputTokens, summary.cost, id)
    },

    /** How many distinct papers the state holds, and when it first saw anything. */
    stats() {
      const row = db.prepare('SELECT COUNT(*) AS n, MIN(first_seen) AS first, MAX(last_seen) AS last FROM papers').get()
      return { papers: row.n, firstSeen: row.first, lastSeen: row.last }
    },

    close() { db.close() },
  }
}
