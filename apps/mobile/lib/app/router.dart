import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

final GoRouter appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(path: '/', builder: (context, state) => const MobileShell()),
  ],
  errorBuilder: (context, state) => Scaffold(
    appBar: AppBar(title: const Text('Navigation error')),
    body: Center(child: Text(state.error?.toString() ?? 'Page unavailable')),
  ),
);

class MobileShell extends StatefulWidget {
  const MobileShell({super.key});

  @override
  State<MobileShell> createState() => _MobileShellState();
}

class _MobileShellState extends State<MobileShell> {
  int selectedIndex = 0;

  static const destinations = [
    (label: 'Home', icon: Icons.home_outlined),
    (label: 'Documents', icon: Icons.folder_outlined),
    (label: 'Study', icon: Icons.school_outlined),
    (label: 'AU Chat', icon: Icons.forum_outlined),
    (label: 'Profile', icon: Icons.person_outline),
  ];

  @override
  Widget build(BuildContext context) {
    final pages = [
      const MobileHomePage(),
      const FeaturePlaceholderPage(
        title: 'My Documents',
        description:
            'Your documents will be imported and processed on this device.',
        icon: Icons.folder_open_rounded,
      ),
      const FeaturePlaceholderPage(
        title: 'Study Space',
        description:
            'Smart Notes, practice exams and predictions in one study workspace.',
        icon: Icons.school_rounded,
      ),
      const FeaturePlaceholderPage(
        title: 'AU Chat',
        description:
            'Ask questions using your selected local model. Cloud access is separately controlled.',
        icon: Icons.forum_rounded,
      ),
      const FeaturePlaceholderPage(
        title: 'Your Profile',
        description:
            'Account, subscription, model settings and app preferences.',
        icon: Icons.account_circle_outlined,
      ),
    ];

    return Scaffold(
      body: SafeArea(
        child: IndexedStack(index: selectedIndex, children: pages),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: (index) => setState(() => selectedIndex = index),
        destinations: [
          for (final destination in destinations)
            NavigationDestination(
              icon: Icon(destination.icon),
              label: destination.label,
            ),
        ],
      ),
    );
  }
}

class MobileHomePage extends StatelessWidget {
  const MobileHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
          sliver: SliverList(
            delegate: SliverChildListDelegate([
              Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: const Icon(Icons.auto_awesome, color: Colors.white),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'DATACUBE AU',
                          style: theme.textTheme.labelLarge?.copyWith(
                            letterSpacing: 1.1,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          'Your learning workspace',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Notifications',
                    onPressed: () {},
                    icon: const Icon(Icons.notifications_none_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 28),
              Text(
                'Good to have you here.',
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Your documents, AI tools and study sessions in one place.',
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 22),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary,
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.auto_awesome,
                      color: Colors.white,
                      size: 25,
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'Learn from your own materials',
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 7),
                    const Text(
                      'Import a document to build your private, on-device study workspace.',
                      style: TextStyle(color: Colors.white70, height: 1.4),
                    ),
                    const SizedBox(height: 18),
                    FilledButton.icon(
                      onPressed: () {},
                      style: FilledButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: theme.colorScheme.primary,
                      ),
                      icon: const Icon(Icons.add),
                      label: const Text('Add a document'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 26),
              Text(
                'Your workspace',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 12),
              const _WorkspaceTile(
                icon: Icons.folder_copy_outlined,
                title: 'My Documents',
                subtitle: 'Import and organise learning materials',
              ),
              const _WorkspaceTile(
                icon: Icons.forum_outlined,
                title: 'AU Chat',
                subtitle: 'Ask questions about your materials',
              ),
              const _WorkspaceTile(
                icon: Icons.auto_stories_outlined,
                title: 'Smart Notes',
                subtitle: 'Turn materials into useful study notes',
              ),
              const _WorkspaceTile(
                icon: Icons.quiz_outlined,
                title: 'Practice & Predictions',
                subtitle: 'Prepare with focused study tools',
              ),
              const SizedBox(height: 18),
              Text(
                'Built around your privacy',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Local processing is the foundation. Cloud features remain optional and subject to account limits.',
                style: theme.textTheme.bodySmall?.copyWith(height: 1.5),
              ),
            ]),
          ),
        ),
      ],
    );
  }
}

class _WorkspaceTile extends StatelessWidget {
  const _WorkspaceTile({
    required this.icon,
    required this.title,
    required this.subtitle,
  });
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: 10),
    child: ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 15, vertical: 7),
      leading: Icon(
        icon,
        color: Theme.of(context).colorScheme.primary,
        size: 25,
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right_rounded),
    ),
  );
}

class FeaturePlaceholderPage extends StatelessWidget {
  const FeaturePlaceholderPage({
    super.key,
    required this.title,
    required this.description,
    required this.icon,
  });
  final String title;
  final String description;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 48, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 16),
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            description,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 14),
          const Text(
            'Feature migration in progress',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ),
    ),
  );
}
