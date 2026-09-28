import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "graph.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      cik TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      name TEXT NOT NULL,
      sector TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS filings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cik TEXT NOT NULL,
      form TEXT NOT NULL,
      filing_date TEXT NOT NULL,
      report_date TEXT,
      accession_number TEXT NOT NULL,
      doc_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      UNIQUE(cik, accession_number)
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_cik TEXT NOT NULL,
      target_cik TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      direction_note TEXT,
      evidence_text TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_verified INTEGER NOT NULL DEFAULT 0,
      filing_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (filing_id) REFERENCES filings(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_cik);
    CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_cik);
  `);
  _db = db;
  return db;
}

export type FilingRow = {
  id: number;
  cik: string;
  form: string;
  filing_date: string;
  report_date: string | null;
  accession_number: string;
  doc_url: string;
  fetched_at: string;
};

export type RelationshipRow = {
  id: number;
  source_cik: string;
  target_cik: string;
  relationship_type: string;
  direction_note: string | null;
  evidence_text: string;
  confidence: number;
  evidence_verified: number;
  filing_id: number;
  created_at: string;
};
