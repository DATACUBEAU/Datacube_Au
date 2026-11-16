import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

final GoRouter appRouter = GoRouter(initialLocation: '/', routes: [
  GoRoute(path: '/', builder: (context, state) => const FoundationHomePage()),
], errorBuilder: (context, state) => Scaffold(appBar: AppBar(title: const Text('Navigation error')), body: Center(child: Text(state.error?.toString() ?? 'Page unavailable'))));

class FoundationHomePage extends StatelessWidget {
  const FoundationHomePage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('DataCube AU')), body: ListView(padding: const EdgeInsets.all(24), children: [
    Text('Your learning workspace', style: Theme.of(context).textTheme.headlineMedium),
    const SizedBox(height: 8), const Text('The mobile foundation is being assembled. Your local workspace will remain available across app restarts.'),
    const SizedBox(height: 24),
    for (final item in const ['Home', 'Documents', 'Study', 'AU Chat', 'Profile']) Card(child: ListTile(leading: const Icon(Icons.grid_view_rounded, color: Color(0xFF3F51B5)), title: Text(item), subtitle: const Text('Feature migration follows foundation verification'))),
  ]));
}
