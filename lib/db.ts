import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

const globalForDb = globalThis as typeof globalThis & {
  __podcastTranslationDb?: Database.Database;
};

const dbConfig = resolveDbConfig();

export const db =
  globalForDb.__podcastTranslationDb ??
  new Database(dbConfig.dbPath, {
    fileMustExist: false,
    timeout: 5000,
  });

if (!globalForDb.__podcastTranslationDb) {
  db.pragma("busy_timeout = 5000");
  if (!dbConfig.inMemory) {
    db.pragma("journal_mode = WAL");
  }
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

function resolveDbConfig() {
  const candidates = [
    path.join(process.cwd(), "storage"),
    path.join("/tmp", "podcast-translation"),
  ];

  for (const dataDir of candidates) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.accessSync(dataDir, fs.constants.W_OK);
      return {
        dbPath: path.join(dataDir, "app.db"),
        inMemory: false,
      };
    } catch {
      continue;
    }
  }

  return {
    dbPath: ":memory:",
    inMemory: true,
  };
}
