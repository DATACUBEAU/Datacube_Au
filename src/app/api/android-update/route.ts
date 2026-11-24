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

/**
 * This endpoint is deliberately public and tiny. Vercel never serves the APK:
 * GitHub's release CDN delivers the 90+ MB binary directly.
 */
export async function GET() {
  try {
    const reply = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DataCube-AU-Update-Manifest' },
      next: { revalidate: 300 },
    });
    if (!reply.ok) throw new Error('Release catalog unavailable');
    const releases: GithubRelease[] = await reply.json();
    const release = releases.find((candidate) =>
      !candidate.draft &&
      /^android-test-[a-f0-9]{12}$/.test(candidate.tag_name || '') &&
      candidate.assets?.some((asset) => asset.name === ASSET_NAME && (asset.size || 0) > 0)
    );
    const asset = release?.assets?.find((item) => item.name === ASSET_NAME);
    if (!release || !asset?.browser_download_url) {
      return NextResponse.json({ error: 'No verified Android update published' }, { status: 404 });
    }
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
        !Number.isSafeInteger(versionCode) || versionCode < 4 ||
        typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 1000000 || sizeBytes > 500000000 ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        data.apkUrl !== expectedUrl ||
        typeof data.releaseSha !== 'string' ||
        !data.releaseSha.startsWith((release.tag_name || '').replace('android-test-', ''))) {
      throw new Error('Release manifest failed validation');
    }
    return NextResponse.json({
      schema: 1,
      versionCode,
      versionName: typeof data.versionName === 'string' ? data.versionName.slice(0, 36) : String(versionCode),
      apkUrl: expectedUrl,
      sha256,
      sizeBytes,
      notes: typeof data.notes === 'string' ? data.notes.slice(0, 500) : 'DataCube AU improvements',
    }, {
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
