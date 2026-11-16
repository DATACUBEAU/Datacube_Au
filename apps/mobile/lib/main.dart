import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'core/background/background_service.dart';
import 'core/database/local_job_repository.dart';
import 'core/notifications/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.instance.initialize();
  await BackgroundService.initialize();

  // Reconcile durable state before the UI starts. Jobs left running when the
  // OS killed the process are moved back to retryable from their last
  // checkpoint. Do not enqueue them until a real executor is registered.
  final jobs = LocalJobRepository.instance;
  await jobs.recoverInterruptedJobs();
  final recoverable = await jobs.recoverableJobs();
  for (final job in recoverable) {
    final id = job['id'];
    if (id is String && job['status'] == 'retryable') {
      final notificationId = id.hashCode & 0x7fffffff;
      await NotificationService.instance.showInterruptedJob(
        notificationId: notificationId,
      );
    }
  }

  runApp(const ProviderScope(child: DataCubeAuApp()));
}
