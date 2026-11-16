import 'dart:convert';

import 'package:drift/drift.dart';

import 'local_database.dart';

/// Durable job state. Payloads contain IDs and small metadata only; never
/// document text, embeddings, prompts or other user content.
class LocalJobRepository {
  LocalJobRepository([LocalDatabase? database])
    : _database = database ?? LocalDatabase();
  static final instance = LocalJobRepository();

  final LocalDatabase _database;

  Future<void> enqueue({
    required String id,
    required String kind,
    required Map<String, Object?> metadata,
  }) async {
    final now = DateTime.now().toUtc();
    await _database
        .into(_database.localJobs)
        .insert(
          LocalJobsCompanion.insert(
            id: id,
            kind: kind,
            status: 'queued',
            payloadJson: jsonEncode(metadata),
            createdAt: now,
            updatedAt: now,
          ),
          mode: InsertMode.insert,
        );
  }

  Future<Map<String, Object?>?> getById(String id) async {
    final row = await (_database.select(
      _database.localJobs,
    )..where((job) => job.id.equals(id))).getSingleOrNull();
    if (row == null) return null;
    return {
      'id': row.id,
      'kind': row.kind,
      'status': row.status,
      'payload_json': row.payloadJson,
      'progress': row.progress,
      'attempts': row.attempts,
      'created_at': row.createdAt.toUtc().toIso8601String(),
      'updated_at': row.updatedAt.toUtc().toIso8601String(),
      'last_error': row.lastError,
    };
  }

  /// Atomically claims a queued/retryable job and increments its attempt count.
  Future<bool> markRunning(String id) async {
    final now = DateTime.now().toUtc();
    final changed =
        await (_database.update(_database.localJobs)..where(
              (job) =>
                  job.id.equals(id) &
                  (job.status.equals('queued') |
                      job.status.equals('retryable')),
            ))
            .write(
              LocalJobsCompanion(
                status: const Value('running'),
                attempts: _database.localJobs.attempts + const Constant(1),
                updatedAt: Value(now),
                lastError: const Value(null),
              ),
            );
    return changed == 1;
  }

  Future<bool> checkpoint(String id, double progress) async {
    if (!progress.isFinite || progress < 0 || progress > 1) {
      throw ArgumentError.value(progress, 'progress');
    }
    final changed =
        await (_database.update(
              _database.localJobs,
            )..where((job) => job.id.equals(id) & job.status.equals('running')))
            .write(
              LocalJobsCompanion(
                progress: Value(progress),
                updatedAt: Value(DateTime.now().toUtc()),
              ),
            );
    return changed == 1;
  }

  Future<bool> finish(String id) =>
      _transition(id, const ['running'], 'completed', progress: 1);

  Future<bool> cancel(String id) =>
      _transition(id, const ['queued', 'running', 'retryable'], 'cancelled');

  Future<bool> retryable(String id, String error) =>
      _transition(id, const ['running'], 'retryable', lastError: error);

  Future<bool> _transition(
    String id,
    List<String> allowedStatuses,
    String nextStatus, {
    double? progress,
    String? lastError,
  }) async {
    final changed =
        await (_database.update(_database.localJobs)..where(
              (job) => job.id.equals(id) & job.status.isIn(allowedStatuses),
            ))
            .write(
              LocalJobsCompanion(
                status: Value(nextStatus),
                updatedAt: Value(DateTime.now().toUtc()),
                progress: progress == null
                    ? const Value.absent()
                    : Value(progress),
                lastError: lastError == null
                    ? const Value.absent()
                    : Value(lastError),
              ),
            );
    return changed == 1;
  }

  /// Jobs left running by process death become eligible for idempotent resume.
  Future<int> recoverInterruptedJobs({
    Duration staleAfter = const Duration(minutes: 15),
  }) async {
    final cutoff = DateTime.now().toUtc().subtract(staleAfter);
    return (_database.update(_database.localJobs)..where(
          (job) =>
              job.status.equals('running') &
              job.updatedAt.isSmallerOrEqualValue(cutoff),
        ))
        .write(
          LocalJobsCompanion(
            status: const Value('retryable'),
            lastError: const Value(
              'Interrupted; resume from last durable checkpoint.',
            ),
            updatedAt: Value(DateTime.now().toUtc()),
          ),
        );
  }

  Future<List<Map<String, Object?>>> recoverableJobs() async {
    final rows =
        await (_database.select(_database.localJobs)
              ..where(
                (job) =>
                    job.status.equals('queued') |
                    job.status.equals('retryable'),
              )
              ..orderBy([(job) => OrderingTerm.asc(job.createdAt)]))
            .get();
    return rows
        .map(
          (row) => <String, Object?>{
            'id': row.id,
            'kind': row.kind,
            'status': row.status,
            'payload_json': row.payloadJson,
            'progress': row.progress,
            'attempts': row.attempts,
            'created_at': row.createdAt.toUtc().toIso8601String(),
            'updated_at': row.updatedAt.toUtc().toIso8601String(),
            'last_error': row.lastError,
          },
        )
        .toList(growable: false);
  }

  Future<void> close() => _database.close();
}
