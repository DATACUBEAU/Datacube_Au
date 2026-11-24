import { NextResponse } from 'next/server';

export const revalidate = 300;
const OWNER = 'DATACUBEAU';
const REPOSITORY = 'Datacube_Au';
const API = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases?per_page=25`;
const ASSET_NAME = 'datacube-update.json';

type GithubRelease = {
  tag_name?: string;
  draft?: boolean;
  assets?: { name?: string; size?: number; browser_download_url?: string }[];
};

async function readRelease(release: GithubRelease) {
    const asset = release.assets?.find((item) => item.name === ASSET_NAME);
    const apk = release.assets?.find((item) => item.name === 'DataCube-AU-Android-arm64.apk');
    if (!asset?.browser_download_url || !apk?.browser_download_url || !release.tag_name) return null;
    const manifestLink = new URL(asset.browser_download_url);
    if (manifestLink.protocol !== 'https:' || manifestLink.hostname !== 'github.com' ||
        manifestLink.pathname !== `/${OWNER}/${REPOSITORY}/releases/download/${release.tag_name}/${ASSET_NAME}`) {
      throw new Error('Unexpected release manifest destination');
    }
    const manifestReply = await fetch(manifestLink, { next: { revalidate: 300 } });
    if (!manifestReply.ok) throw new Error('Release manifest could not be read');
    const body = await manifestReply.text();
    if (body.length > 8192) throw new Error('Release manifest exceeds size limit');
    const data = JSON.parse(body) as Record<string, unknown>;
    const expectedUrl = `https://github.com/${OWNER}/${REPOSITORY}/releases/download/${release.tag_name}/DataCube-AU-Android-arm64.apk`;
    const versionCode = data.versionCode;
    const sizeBytes = data.sizeBytes;
    const sha256 = data.sha256;
    if (data.schema !== 1 || typeof versionCode !== 'number' ||
        !Number.isSafeInteger(versionCode) || versionCode < 4 || versionCode > 2100000000 ||
        typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 1000000 || sizeBytes > 500000000 ||
        apk.size !== sizeBytes ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        data.apkUrl !== expectedUrl ||
        typeof data.releaseSha !== 'string' ||
        !/^[a-f0-9]{40}$/.test(data.releaseSha) ||
        !data.releaseSha.startsWith((release.tag_name || '').replace('android-test-', ''))) {
      throw new Error('Release manifest failed validation');
    }
    if (apk.browser_download_url !== expectedUrl) throw new Error('Unexpected APK destination');
    return {
      schema: 1,
      versionCode,
      versionName: typeof data.versionName === 'string' ? data.versionName.slice(0, 36) : String(versionCode),
      apkUrl: expectedUrl,
      sha256,
      sizeBytes,
      notes: typeof data.notes === 'string' ? data.notes.slice(0, 500) : 'DataCube AU improvements',
    };
}

/** Serve the highest validated Android version, not merely the most recently published release. */
export async function GET() {
  try {
    const reply = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DataCube-AU-Update-Manifest' },
      next: { revalidate: 300 },
    });
    if (!reply.ok) throw new Error('Release catalog unavailable');
    const releases: GithubRelease[] = await reply.json();
    const candidates = releases.filter((candidate) =>
      !candidate.draft &&
      /^android-test-[a-f0-9]{12}$/.test(candidate.tag_name || '') &&
      candidate.assets?.some((asset) => asset.name === ASSET_NAME && (asset.size || 0) > 0) &&
      candidate.assets?.some((asset) => asset.name === 'DataCube-AU-Android-arm64.apk' && (asset.size || 0) > 0)
    );
    if (!candidates.length) {
      return NextResponse.json({ error: 'No verified Android update published' }, { status: 404 });
    }
    let latest: Awaited<ReturnType<typeof readRelease>> = null;
    for (let i = 0; i < candidates.length; i += 5) {
      const results = await Promise.all(candidates.slice(i, i + 5).map((release) =>
        readRelease(release).catch(() => null)
      ));
      for (const result of results) {
        if (result && (!latest || result.versionCode > latest.versionCode)) latest = result;
      }
    }
    if (!latest) throw new Error('No complete verified release');
    return NextResponse.json(latest, {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Update information is temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
