import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

/// Local-only database foundation. Evolve schema using forward migrations.
class LocalDatabase {
  LocalDatabase._();
  static final LocalDatabase instance = LocalDatabase._();
  Database? _db;
  Future<Database> get database async {
    if (_db != null) return _db!;
    final dir = await getApplicationSupportDirectory();
    _db = await openDatabase(path.join(dir.path, 'datacube_au.db'), version: 1,
      onConfigure: (db) async { await db.execute('PRAGMA foreign_keys = ON'); await db.execute('PRAGMA journal_mode = WAL'); await db.execute('PRAGMA synchronous = NORMAL'); },
      onCreate: (db, version) async {
        await db.execute('CREATE TABLE local_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_error TEXT)');
        await db.execute('CREATE INDEX idx_local_jobs_status_created ON local_jobs(status, created_at)');
        await db.execute('CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
      });
    return _db!;
  }
  Future<void> close() async { await _db?.close(); _db = null; }
}
