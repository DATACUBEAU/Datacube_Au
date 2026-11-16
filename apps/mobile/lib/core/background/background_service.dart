import 'dart:ui';

import 'package:flutter/widgets.dart';
import 'package:workmanager/workmanager.dart';

import '../database/local_job_repository.dart';
import '../notifications/notification_service.dart';

const localMaintenanceTask = 'au.local.maintenance';
const localIngestionTask = 'au.local.ingestion';

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    WidgetsFlutterBinding.ensureInitialized();
    DartPluginRegistrant.ensureInitialized();

    try {
      switch (task) {
        case localMaintenanceTask:
          // Maintenance is intentionally non-destructive until a lease/heartbeat
          // executor is installed; it must not reset jobs another isolate owns.
          return true;
        case localIngestionTask:
          final jobId = inputData?['jobId'];
          if (jobId is! String || jobId.isEmpty) return true;

          // Deliberately do not claim or execute this job until the local
          // ingestion executor is registered. A worker must reload durable
          // state by ID; WorkManager input must never contain document data.
          final job = await LocalJobRepository.instance.getById(jobId);
          if (job == null || job['status'] == 'cancelled') return true;
          return false;
        default:
          return true;
      }
    } catch (_) {
      return false;
    }
  });
}

abstract final class BackgroundService {
  static bool _initialized = false;

  static Future<void> initialize() async {
    if (_initialized) return;
    await Workmanager().initialize(callbackDispatcher);
    _initialized = true;
  }

  static Future<void> scheduleMaintenance() =>
      Workmanager().registerPeriodicTask(
        'au-local-maintenance-periodic',
        localMaintenanceTask,
        frequency: const Duration(hours: 12),
        constraints: Constraints(
          networkType: NetworkType.not_required,
          requiresBatteryNotLow: true,
        ),
        existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
      );

  /// Only a durable local job ID may cross the WorkManager boundary.
  /// Callers must persist the job before invoking this method.
  static Future<void> enqueueIngestion({required String jobId}) {
    if (jobId.trim().isEmpty) {
      throw ArgumentError.value(jobId, 'jobId', 'Must not be empty');
    }
    return Workmanager().registerOneOffTask(
      'au-ingestion-$jobId',
      localIngestionTask,
      inputData: <String, dynamic>{'jobId': jobId},
      constraints: Constraints(
        networkType: NetworkType.not_required,
        requiresBatteryNotLow: true,
      ),
      existingWorkPolicy: ExistingWorkPolicy.keep,
      backoffPolicy: BackoffPolicy.exponential,
      backoffPolicyDelay: const Duration(seconds: 30),
    );
  }

  static Future<void> cancel(String jobId) =>
      Workmanager().cancelByUniqueName('au-ingestion-$jobId');
}
