import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';

/// Durable job state. Worker payloads should contain IDs and small metadata,
/// never document text, embeddings, prompts or other user content.
class LocalJobRepository {
  LocalJobRepository._();
  static final instance = LocalJobRepository._();
  Future<Database> get _db => LocalDatabase.instance.database;

  Future<void> enqueue({required String id, required String kind, required Map<String, Object?> metadata}) async {
    final db = await _db;
    final now = DateTime.now().toUtc().toIso8601String();
    await db.insert('local_jobs', {
      'id': id, 'kind': kind, 'status': 'queued',
      'payload_json': jsonEncode(metadata), 'progress': 0.0,
      'attempts': 0, 'created_at': now, 'updated_at': now,
    }, conflictAlgorithm: ConflictAlgorithm.abort);
  }

  Future<Map<String, Object?>?> getById(String id) async {
    final rows = await (await _db).query('local_jobs', where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<bool> markRunning(String id) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final changed = await (await _db).update('local_jobs', {
      'status': 'running', 'attempts': 1, 'updated_at': now,
    }, where: 'id = ? AND status IN (?, ?)', whereArgs: [id, 'queued', 'retryable']);
    return changed == 1;
  }

  Future<void> checkpoint(String id, double progress) async {
    if (progress < 0 || progress > 1) throw ArgumentError.value(progress, 'progress');
    await (await _db).update('local_jobs', {
      'progress': progress, 'updated_at': DateTime.now().toUtc().toIso8601String(),
    }, where: 'id = ? AND status = ?', whereArgs: [id, 'running']);
  }

  Future<void> finish(String id) async => _setStatus(id, 'completed');
  Future<void> cancel(String id) async => _setStatus(id, 'cancelled');
  Future<void> retryable(String id, String error) async {
    await (await _db).update('local_jobs', {
      'status': 'retryable', 'last_error': error,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }, where: 'id = ? AND status != ?', whereArgs: [id, 'completed']);
  }

  Future<void> _setStatus(String id, String status) async {
    await (await _db).update('local_jobs', {
      'status': status, 'updated_at': DateTime.now().toUtc().toIso8601String(),
    }, where: 'id = ?', whereArgs: [id]);
  }

  Future<List<Map<String, Object?>>> recoverableJobs() async => (await _db).query(
    'local_jobs', where: 'status IN (?, ?)', whereArgs: ['queued', 'retryable'],
    orderBy: 'created_at ASC',
  );
}
