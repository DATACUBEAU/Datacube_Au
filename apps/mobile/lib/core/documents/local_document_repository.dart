import 'dart:io';
import 'package:drift/drift.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';
import '../database/local_database.dart';

class LocalDocument {
  const LocalDocument({
    required this.id,
    required this.name,
    required this.extension,
    required this.mimeType,
    required this.sizeBytes,
    required this.storagePath,
    required this.status,
    required this.createdAt,
  });
  final String id, name, extension, mimeType, storagePath, status;
  final int sizeBytes;
  final DateTime createdAt;
  String get readableSize => sizeBytes < 1024
      ? '$sizeBytes B'
      : sizeBytes < 1048576
      ? '${(sizeBytes / 1024).toStringAsFixed(1)} KB'
      : '${(sizeBytes / 1048576).toStringAsFixed(1)} MB';
}

class LocalDocumentRepository {
  LocalDocumentRepository([LocalDatabase? database])
    : _database = database ?? LocalDatabase();
  final LocalDatabase _database;
  static const _uuid = Uuid();
  static const maxDocumentBytes = 100 * 1024 * 1024;

  Future<List<LocalDocument>> listDocuments() async {
    final rows = await (_database.select(
      _database.localDocuments,
    )..orderBy([(row) => OrderingTerm.desc(row.createdAt)])).get();
    return rows.map(_fromRow).toList(growable: false);
  }

  Future<LocalDocument> importDocument({
    required String sourcePath,
    required String displayName,
  }) async {
    final source = File(sourcePath);
    if (!await source.exists())
      throw const FileSystemException(
        'The selected file is no longer available.',
      );
    final size = await source.length();
    if (size <= 0) throw const FormatException('The selected file is empty.');
    if (size > maxDocumentBytes)
      throw const FormatException('Files must be 100 MB or smaller.');
    final extension = _extensionOf(displayName);
    const supported = {'pdf', 'docx', 'txt', 'rtf', 'md'};
    if (!supported.contains(extension))
      throw const FormatException(
        'Choose a PDF, DOCX, TXT, RTF or Markdown file.',
      );

    final id = _uuid.v4();
    final appDirectory = await getApplicationDocumentsDirectory();
    final directory = Directory('${appDirectory.path}/documents');
    await directory.create(recursive: true);
    final destination = File('${directory.path}/$id.$extension');
    try {
      await source.copy(destination.path);
      final now = DateTime.now().toUtc();
      await _database
          .into(_database.localDocuments)
          .insert(
            LocalDocumentsCompanion.insert(
              id: id,
              name: displayName,
              extension: extension,
              mimeType: _mimeTypeFor(extension),
              sizeBytes: size,
              storagePath: destination.path,
              createdAt: now,
              updatedAt: now,
            ),
          );
      return LocalDocument(
        id: id,
        name: displayName,
        extension: extension,
        mimeType: _mimeTypeFor(extension),
        sizeBytes: size,
        storagePath: destination.path,
        status: 'imported',
        createdAt: now,
      );
    } catch (_) {
      if (await destination.exists()) await destination.delete();
      rethrow;
    }
  }

  Future<bool> deleteDocument(String id) async {
    final row = await (_database.select(
      _database.localDocuments,
    )..where((document) => document.id.equals(id))).getSingleOrNull();
    if (row == null) return false;
    await (_database.delete(
      _database.localDocuments,
    )..where((document) => document.id.equals(id))).go();
    final file = File(row.storagePath);
    if (await file.exists()) await file.delete();
    return true;
  }

  LocalDocument _fromRow(LocalDocumentData row) => LocalDocument(
    id: row.id,
    name: row.name,
    extension: row.extension,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storagePath: row.storagePath,
    status: row.status,
    createdAt: row.createdAt,
  );
  String _extensionOf(String name) {
    final index = name.lastIndexOf('.');
    return index < 0 ? '' : name.substring(index + 1).toLowerCase();
  }

  String _mimeTypeFor(String extension) => switch (extension) {
    'pdf' => 'application/pdf',
    'docx' =>
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt' => 'text/plain',
    'rtf' => 'application/rtf',
    'md' => 'text/markdown',
    _ => 'application/octet-stream',
  };
}
