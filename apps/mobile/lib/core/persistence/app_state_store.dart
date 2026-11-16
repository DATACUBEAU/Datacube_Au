import 'package:shared_preferences/shared_preferences.dart';

/// Stores non-critical UI preferences only. Critical job and feature state
/// belongs in the local database; secrets belong in secure storage.
class AppStateStore {
  AppStateStore._();
  static final AppStateStore instance = AppStateStore._();
  final SharedPreferencesAsync _preferences = SharedPreferencesAsync();

  Future<String?> getLastRoute() => _preferences.getString('app.last_route');
  Future<void> saveLastRoute(String route) => _preferences.setString('app.last_route', route);
  Future<bool> getOnboardingComplete() async =>
      await _preferences.getBool('app.onboarding_complete') ?? false;
  Future<void> saveOnboardingComplete(bool value) =>
      _preferences.setBool('app.onboarding_complete', value);
}
