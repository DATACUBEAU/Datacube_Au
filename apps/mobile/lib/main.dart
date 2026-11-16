import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app/app.dart';
import 'core/background/background_service.dart';
import 'core/notifications/notification_service.dart';
import 'core/persistence/app_state_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppStateStore.instance.initialize();
  await NotificationService.instance.initialize();
  await BackgroundService.initialize();
  runApp(const ProviderScope(child: DataCubeAuApp()));
}
