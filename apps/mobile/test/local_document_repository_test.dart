import 'dart:io';
import 'package:datacube_au/core/database/local_database.dart';
import 'package:datacube_au/core/documents/local_document_repository.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late LocalDatabase database;
  late LocalDocumentRepository repository;
  late Directory temporaryDirectory;
  setUp(() async {
    database = LocalDatabase.forTesting(NativeDatabase.memory());
    repository = LocalDocumentRepository(database);
    temporaryDirectory = await Directory.systemTemp.createTemp(
      'datacube-docs-',
    );
  });
  tearDown(() async {
    await database.close();
    if (await temporaryDirectory.exists())
      await temporaryDirectory.delete(recursive: true);
  });
  test('rejects unsupported document extensions', () async {
    final file = File('${temporaryDirectory.path}/script.exe');
    await file.writeAsString('not an allowed document');
    expect(
      () => repository.importDocument(
        sourcePath: file.path,
        displayName: 'script.exe',
      ),
      throwsA(isA<FormatException>()),
    );
  });
  test('rejects empty documents', () async {
    final file = File('${temporaryDirectory.path}/empty.txt');
    await file.create();
    expect(
      () => repository.importDocument(
        sourcePath: file.path,
        displayName: 'empty.txt',
      ),
      throwsA(isA<FormatException>()),
    );
  });
}
