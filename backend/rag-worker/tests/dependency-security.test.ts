import fs from 'fs';
import path from 'path';

function resolvedPackageVersion(moduleName: string): string {
  const entryPath = require.resolve(moduleName);
  let current = path.dirname(entryPath);

  while (true) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === moduleName && manifest.version) {
        return manifest.version;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Unable to locate package manifest for ${moduleName} from ${entryPath}`);
}

describe('production dependency security pins', () => {
  test('runtime tar resolution stays on the patched release', () => {
    expect(resolvedPackageVersion('tar')).toBe('7.5.22');
  });

  test('protobufjs override stays above the critical vulnerable range', () => {
    expect(resolvedPackageVersion('protobufjs')).toBe('7.6.5');
  });
});
