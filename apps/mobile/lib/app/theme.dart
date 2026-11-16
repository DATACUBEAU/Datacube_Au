import 'package:flutter/material.dart';

abstract final class DataCubeTheme {
  static const blue = Color(0xFF3F51B5);
  static const ink = Color(0xFF101828);
  static const paper = Color(0xFFFFFFFF);
  static ThemeData get light => _build(Brightness.light, const Color(0xFFF7F9FC), paper, ink, const Color(0xFFE4E9F1));
  static ThemeData get dark => _build(Brightness.dark, const Color(0xFF090F1D), const Color(0xFF111A2B), const Color(0xFFF5F7FB), const Color(0xFF263247));
  static ThemeData _build(Brightness brightness, Color background, Color surface, Color foreground, Color border) {
    final scheme = ColorScheme.fromSeed(seedColor: blue, brightness: brightness, surface: surface);
    return ThemeData(useMaterial3: true, brightness: brightness,
      colorScheme: scheme.copyWith(primary: blue, onPrimary: paper, surface: surface, onSurface: foreground),
      scaffoldBackgroundColor: background,
      appBarTheme: AppBarTheme(backgroundColor: background, foregroundColor: foreground, elevation: 0),
      cardTheme: CardTheme(color: surface, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: border))),
      dividerColor: border,
    );
  }
}
