import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;
  Future<void> initialize() async {
    if (_ready) return;
    const settings = InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher'));
    await _plugin.initialize(settings);
    _ready = true;
  }
  Future<void> requestPermission() async {
    await initialize();
    await _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission();
  }
  Future<void> showJobUpdate({required int id, required String title, required String body}) async {
    await initialize();
    const details = NotificationDetails(android: AndroidNotificationDetails('au_background_jobs', 'Background processing', channelDescription: 'Document processing and model download updates', importance: Importance.low, priority: Priority.low));
    await _plugin.show(id, title, body, details);
  }
}
