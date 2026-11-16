import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'local_database.g.dart';

class LocalJobs extends Table {
  TextColumn get id => text()();
  TextColumn get kind => text()();
  TextColumn get status => text()();
  TextColumn get payloadJson => text()();
  RealColumn get progress => real().withDefault(const Constant(0))();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  TextColumn get lastError => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};

  @override
  List<Set<Column<Object>>> get uniqueKeys => [];
}

class AppKv extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

/// Device-local database. drift_flutter chooses a durable app-private location
/// and supports opening the same database from background isolates.
@DriftDatabase(tables: [LocalJobs, AppKv])
class LocalDatabase extends _$LocalDatabase {
  LocalDatabase() : super(driftDatabase(name: 'datacube_au'));

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) async {
          await m.createAll();
          await customStatement(
            'CREATE INDEX idx_local_jobs_status_created '
            'ON local_jobs (status, created_at)',
          );
        },
        onUpgrade: (m, from, to) async {
          // Add forward-only migrations here. Never drop user document data.
        },
        beforeOpen: (details) async {
          await customStatement('PRAGMA foreign_keys = ON');
          await customStatement('PRAGMA journal_mode = WAL');
          await customStatement('PRAGMA synchronous = NORMAL');
        },
      );
}
