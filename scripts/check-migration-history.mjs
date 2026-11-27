import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Input is a JSON array of live migration records (version only; no SQL or credentials).
export function compareMigrationVersions(files, liveRecords) {
  const local = files.filter(name => name.endsWith('.sql')).map(name => {
    const match = /^(\d{14})_.+\.sql$/.exec(name);
    if (!match) throw new Error('Invalid migration filename: ' + name);
    return match[1];
  });
  if (!Array.isArray(liveRecords) || !liveRecords.length) throw new Error('Expected a nonempty live migration array');
  const live = liveRecords.map(record => {
    const version = typeof record === 'string' ? record : record?.version;
    if (typeof version !== 'string' || !/^\d{14}$/.test(version)) throw new Error('Invalid live migration version');
    return version;
  });
  const duplicates = values => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
  const localSet = new Set(local);
  const liveSet = new Set(live);
  return {
    missingFromRepository: [...liveSet].filter(version => !localSet.has(version)).sort(),
    notRecordedLive: [...localSet].filter(version => !liveSet.has(version)).sort(),
    duplicateRepositoryVersions: duplicates(local),
    duplicateLiveVersions: duplicates(live),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = process.argv[2];
    if (!input) throw new Error('Usage: node scripts/check-migration-history.mjs <live-versions.json>');
    const report = compareMigrationVersions(readdirSync('supabase/migrations'), JSON.parse(readFileSync(input, 'utf8')));
    console.log(JSON.stringify(report, null, 2));
    // Both missing and pending versions need explicit disposition before production push.
    if (Object.values(report).some(values => values.length)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
