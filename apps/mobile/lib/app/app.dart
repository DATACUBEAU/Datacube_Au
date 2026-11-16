import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'router.dart';
import 'theme.dart';

class DataCubeAuApp extends ConsumerWidget {
  const DataCubeAuApp({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
    title: 'DataCube AU', debugShowCheckedModeBanner: false,
    theme: DataCubeTheme.light, darkTheme: DataCubeTheme.dark,
    themeMode: ThemeMode.system, routerConfig: appRouter,
    restorationScopeId: 'datacube-au-root',
  );
}
