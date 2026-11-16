import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  NotificationService._();
  static final instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  bool _ready = false;

  Future<void> initialize() async {
    if (_ready) return;
    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );
    await _plugin.initialize(settings);
    const channel = AndroidNotificationChannel(
      'au_background_jobs',
      'Background processing',
      description: 'Status updates for local document processing.',
      importance: Importance.low,
    );
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(channel);
    _ready = true;
  }

  Future<void> requestPermission() async {
    await initialize();
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
  }

  /// Use generic status text only. Never pass document names or content.
  Future<void> showJobUpdate({
    required int id,
    required String title,
    required String body,
  }) async {
    await initialize();
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'au_background_jobs',
        'Background processing',
        channelDescription: 'Status updates for local document processing.',
        importance: Importance.low,
        priority: Priority.low,
        onlyAlertOnce: true,
      ),
    );
    await _plugin.show(id, title, body, details);
  }

  Future<void> showQueuedJob({required int notificationId}) => showJobUpdate(
    id: notificationId,
    title: 'DataCube AU',
    body: 'A task is waiting to be processed on this device.',
  );

  Future<void> showInterruptedJob({required int notificationId}) =>
      showJobUpdate(
        id: notificationId,
        title: 'DataCube AU',
        body: 'A task was paused and can resume when processing is available.',
      );

  Future<void> cancelJob(int notificationId) async {
    await initialize();
    await _plugin.cancel(notificationId);
  }
}
