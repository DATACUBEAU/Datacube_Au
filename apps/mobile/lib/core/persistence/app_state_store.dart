import 'package:shared_preferences/shared_preferences.dart';

/// Lightweight UI preferences only; feature content belongs in private storage.
class AppStateStore {
  AppStateStore._();
  static final AppStateStore instance = AppStateStore._();
  SharedPreferences? _prefs;
  Future<void> initialize() async { _prefs ??= await SharedPreferences.getInstance(); }
  String? get lastRoute => _prefs?.getString('app.last_route');
  Future<void> saveLastRoute(String route) async { await _prefs?.setString('app.last_route', route); }
  bool get onboardingComplete => _prefs?.getBool('app.onboarding_complete') ?? false;
  Future<void> saveOnboardingComplete(bool value) async { await _prefs?.setBool('app.onboarding_complete', value); }
}
