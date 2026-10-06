// THE READING STATE: what has been read, and what each paper answered.
//
// Separate from the screening state on purpose. Screening asks "have I seen this paper?" and the
// answer is a boolean that only ever goes one way. Reading asks "what did this paper say about each
// open item?", which is a matrix that GROWS as both more papers are read and the project's open items
// change -- and the same paper read against a later revision of the set is a new row of information,
// not a duplicate.
//
// That is why a read is keyed by (paper, revision) rather than by paper: a paper read against
// `open-items@1` and again against `open-items@2` answered different questions, and collapsing them
// would silently mix two instruments.

export async function openReads(path) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reads (
      paper_id   TEXT NOT NULL,
      revision   TEXT NOT NULL,
      read_at    INTEGER NOT NULL,
      title      TEXT,
      source     TEXT,
      chars      INTEGER,
      degraded   INTEGER NOT NULL DEFAULT 0,
      note       TEXT,
      PRIMARY KEY (paper_id, revision)
    );
    CREATE TABLE IF NOT EXISTS answers (
      paper_id    TEXT NOT NULL,
      revision    TEXT NOT NULL,
      question_id TEXT NOT NULL,
      kind        TEXT,
      value       REAL,
      label       TEXT,
      coverage    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (paper_id, revision, question_id)
    );
    CREATE INDEX IF NOT EXISTS answers_by_revision ON answers (revision, question_id);
  `)
  return {
    db,
    /** Record one paper and everything it answered. Re-reading replaces that revision's row. */
    record(paper, answers, revision) {
      const now = Date.now()
      db.prepare(`
        INSERT INTO reads (paper_id, revision, read_at, title, source, chars, degraded, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(paper_id, revision) DO UPDATE SET
          read_at = excluded.read_at, title = excluded.title, source = excluded.source,
          chars = excluded.chars, degraded = excluded.degraded, note = excluded.note
      `).run(paper.id, revision, now, paper.title ?? null, paper.source ?? null, paper.chars ?? null,
        paper.degraded ? 1 : 0, paper.note ?? null)

      for (const [questionId, answer] of Object.entries(answers)) {
        db.prepare(`
          INSERT INTO answers (paper_id, revision, question_id, kind, value, label, coverage)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(paper_id, revision, question_id) DO UPDATE SET
            kind = excluded.kind, value = excluded.value, label = excluded.label, coverage = excluded.coverage
        `).run(paper.id, revision, questionId, answer.type ?? null,
          typeof answer.probability === 'number' ? answer.probability
            : typeof answer.level === 'number' ? answer.level : null,
          answer.label ?? null, answer.coverage ? 1 : 0)
      }
    },

    /** Every paper read at a revision, each with its answers, ready for `coverageMatrix`. */
    rows(revision) {
      const papers = db.prepare('SELECT * FROM reads WHERE revision = ? ORDER BY read_at').all(revision)
      return papers.map((paper) => {
        const answers = {}
        for (const row of db.prepare('SELECT * FROM answers WHERE revision = ? AND paper_id = ?').all(revision, paper.paper_id)) {
          answers[row.question_id] = { type: row.kind, probability: row.value, label: row.label, coverage: row.coverage === 1 }
        }
        return { paperId: paper.paper_id, title: paper.title, source: paper.source, degraded: paper.degraded === 1, answers }
      })
    },

    /** What has been read, at which revisions -- the instrument's history. */
    revisions() {
      return db.prepare('SELECT revision, COUNT(*) AS papers, MAX(read_at) AS last_read FROM reads GROUP BY revision ORDER BY last_read DESC').all()
    },

    close() { db.close() },
  }
}
