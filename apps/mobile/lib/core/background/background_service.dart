import 'dart:ui';
import 'package:flutter/widgets.dart';
import 'package:workmanager/workmanager.dart';
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
          await NotificationService.instance.initialize();
          return true;
        case localIngestionTask:
          // Real executor is registered with the local-ingestion feature slice.
          return false;
        default:
          return true;
      }
    } catch (_) { return false; }
  });
}

abstract final class BackgroundService {
  static bool _initialized = false;
  static Future<void> initialize() async {
    if (_initialized) return;
    await Workmanager().initialize(callbackDispatcher);
    _initialized = true;
  }
  static Future<void> scheduleMaintenance() => Workmanager().registerPeriodicTask(
    'au-local-maintenance-periodic', localMaintenanceTask,
    frequency: const Duration(hours: 12),
    constraints: Constraints(networkType: NetworkType.not_required, requiresBatteryNotLow: true),
    existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
  );
  static Future<void> enqueueIngestion({required String jobId, required Map<String, dynamic> inputData}) => Workmanager().registerOneOffTask(
    'au-ingestion-$jobId', localIngestionTask, inputData: inputData,
    constraints: Constraints(networkType: NetworkType.not_required, requiresBatteryNotLow: true),
    existingWorkPolicy: ExistingWorkPolicy.keep,
    backoffPolicy: BackoffPolicy.exponential, backoffPolicyDelay: const Duration(seconds: 30),
  );
  static Future<void> cancel(String uniqueName) => Workmanager().cancelByUniqueName(uniqueName);
}
