import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/core/database/local_database.dart';
import '../lib/core/database/local_job_repository.dart';

void main() {
  late LocalDatabase database;
  late LocalJobRepository jobs;

  setUp(() {
    database = LocalDatabase.forTesting(NativeDatabase.memory());
    jobs = LocalJobRepository(database);
  });

  tearDown(() async {
    await jobs.close();
  });

  test('enqueue persists metadata and starts queued', () async {
    await jobs.enqueue(id: 'job-1', kind: 'import', metadata: {'fileId': 'f1'});
    final job = await jobs.getById('job-1');

    expect(job?['status'], 'queued');
    expect(job?['attempts'], 0);
    expect(job?['payload_json'], '{"fileId":"f1"}');
  });

  test('claim is exclusive and increments attempts on every retry', () async {
    await jobs.enqueue(id: 'job-2', kind: 'import', metadata: {});
    expect(await jobs.markRunning('job-2'), isTrue);
    expect(await jobs.markRunning('job-2'), isFalse);
    expect(await jobs.retryable('job-2', 'temporary'), isTrue);
    expect(await jobs.markRunning('job-2'), isTrue);

    final job = await jobs.getById('job-2');
    expect(job?['attempts'], 2);
    expect(job?['status'], 'running');
    expect(job?['last_error'], isNull);
  });

  test('checkpoint and completion only affect running jobs', () async {
    await jobs.enqueue(id: 'job-3', kind: 'import', metadata: {});
    expect(await jobs.checkpoint('job-3', 0.4), isFalse);
    await jobs.markRunning('job-3');
    expect(await jobs.checkpoint('job-3', 0.4), isTrue);
    expect(await jobs.finish('job-3'), isTrue);
    expect(await jobs.cancel('job-3'), isFalse);

    final job = await jobs.getById('job-3');
    expect(job?['status'], 'completed');
    expect(job?['progress'], 1);
  });

  test(
    'interrupted running jobs become retryable for restart recovery',
    () async {
      await jobs.enqueue(id: 'job-4', kind: 'import', metadata: {});
      await jobs.markRunning('job-4');

      expect(await jobs.recoverInterruptedJobs(), 1);
      final recoverable = await jobs.recoverableJobs();

      expect(recoverable.single['id'], 'job-4');
      expect(recoverable.single['status'], 'retryable');
    },
  );

  test('rejects invalid progress', () async {
    await jobs.enqueue(id: 'job-5', kind: 'import', metadata: {});
    await jobs.markRunning('job-5');

    expect(() => jobs.checkpoint('job-5', 1.2), throwsArgumentError);
  });
}
