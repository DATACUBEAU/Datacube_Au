import 'package:file_picker/file_picker.dart';
import 'package:material_ui/material_ui.dart';
import '../../core/documents/local_document_repository.dart';

class DocumentsPage extends StatefulWidget {
  const DocumentsPage({super.key});
  @override
  State<DocumentsPage> createState() => _DocumentsPageState();
}

class _DocumentsPageState extends State<DocumentsPage> {
  final _repository = LocalDocumentRepository();
  List<LocalDocument> _documents = const [];
  bool _loading = true, _importing = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    try {
      final docs = await _repository.listDocuments();
      if (!mounted) return;
      setState(() {
        _documents = docs;
        _loading = false;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load documents stored on this device.';
      });
    }
  }

  Future<void> _pickDocument() async {
    if (_importing) return;
    setState(() {
      _importing = true;
      _error = null;
    });
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'docx', 'txt', 'rtf', 'md'],
      );
      if (result == null || result.files.isEmpty) return;
      final selected = result.files.single;
      final path = selected.path;
      if (path == null || path.isEmpty)
        throw const FormatException('The selected file could not be accessed.');
      await _repository.importDocument(
        sourcePath: path,
        displayName: selected.name,
      );
      await _loadDocuments();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Document saved securely on this device.'),
          ),
        );
    } on FormatException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Import failed. Please try again.');
    } finally {
      if (mounted) setState(() => _importing = false);
    }
  }

  Future<void> _deleteDocument(LocalDocument document) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete document?'),
        content: Text('Remove "${document.name}" from this device?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _repository.deleteDocument(document.id);
    await _loadDocuments();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Documents'),
        actions: [
          IconButton(
            tooltip: 'Refresh documents',
            onPressed: _loadDocuments,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDocuments,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 28),
          children: [
            Text(
              'Your private library',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Files are copied into this app’s private storage. Document content is not uploaded to DataCube servers.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _importing ? null : _pickDocument,
              icon: _importing
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.add_rounded),
              label: Text(_importing ? 'Importing…' : 'Import a document'),
            ),
            const SizedBox(height: 14),
            if (_error != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Text(
                    _error!,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
              ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_documents.isEmpty)
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 30,
                  ),
                  child: Column(
                    children: [
                      Icon(
                        Icons.folder_open_rounded,
                        size: 42,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Your library is empty',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        'Import a PDF, DOCX, TXT, RTF or Markdown file to get started.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              )
            else ...[
              Row(
                children: [
                  Text(
                    'Your files',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Spacer(),
                  Text('${_documents.length}'),
                ],
              ),
              const SizedBox(height: 8),
              for (final document in _documents)
                Card(
                  margin: const EdgeInsets.only(bottom: 9),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: theme.colorScheme.primaryContainer,
                      child: Icon(
                        document.extension == 'pdf'
                            ? Icons.picture_as_pdf_outlined
                            : Icons.description_outlined,
                        color: theme.colorScheme.primary,
                      ),
                    ),
                    title: Text(
                      document.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      '${document.extension.toUpperCase()} • ${document.readableSize} • Stored on device',
                    ),
                    trailing: PopupMenuButton<String>(
                      onSelected: (value) {
                        if (value == 'delete') _deleteDocument(document);
                      },
                      itemBuilder: (context) => const [
                        PopupMenuItem(
                          value: 'delete',
                          child: Text('Delete from device'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
            const SizedBox(height: 12),
            Text(
              'Import currently stores files locally. Text extraction, OCR, indexing and AI chat are the next implementation slice.',
              style: theme.textTheme.bodySmall?.copyWith(height: 1.45),
            ),
          ],
        ),
      ),
    );
  }
}
