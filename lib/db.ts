import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

const dataDir = path.join(process.cwd(), "storage");
const dbPath = path.join(dataDir, "app.db");

fs.mkdirSync(dataDir, { recursive: true });

const globalForDb = globalThis as typeof globalThis & {
  __podcastTranslationDb?: Database.Database;
};

export const db =
  globalForDb.__podcastTranslationDb ??
  new Database(dbPath, {
    fileMustExist: false,
    timeout: 5000,
  });

if (!globalForDb.__podcastTranslationDb) {
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_type TEXT NOT NULL,
      platform TEXT NOT NULL,
      target_language TEXT NOT NULL,
      title TEXT,
      show_title TEXT,
      cover_url TEXT,
      duration_seconds INTEGER,
      status TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      audio_original_path TEXT,
      audio_translated_path TEXT,
      transcript_original_json TEXT NOT NULL DEFAULT '[]',
      transcript_translated_json TEXT NOT NULL DEFAULT '[]',
      transcript_bilingual_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      job_id TEXT,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  globalForDb.__podcastTranslationDb = db;
}
