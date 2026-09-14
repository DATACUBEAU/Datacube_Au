import fs from 'fs';
import path from 'path';

// These assertions intentionally pin the worker's bootstrap resource bounds.
describe('FastEmbed model archive bootstrap safety', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ingestion.ts'), 'utf8');

  it('bounds redirects and requires HTTPS across redirect hops', () => {
    expect(source).toContain('FASTEMBED_MODEL_ARCHIVE_MAX_REDIRECTS');
    expect(source).toContain('redirectCount >= this.modelArchiveMaxRedirects');
    expect(source).toContain("parsedUrl.protocol !== 'https:'");
    expect(source).toContain("redirectUrl.protocol !== 'https:'");
    expect(source).toContain('new URL(response.headers.location, parsedUrl)');
  });

  it('bounds compressed archive downloads using header and streamed byte checks', () => {
    expect(source).toContain('FASTEMBED_MODEL_ARCHIVE_MAX_BYTES');
    expect(source).toContain("response.headers['content-length']");
    expect(source).toContain('contentLength > this.modelArchiveMaxBytes');
    expect(source).toContain('bytes > this.modelArchiveMaxBytes');
    expect(source).toContain('response.unpipe(out)');
  });

  it('bounds decompressed gzip validation work', () => {
    expect(source).toContain('FASTEMBED_MODEL_ARCHIVE_MAX_EXPANDED_BYTES');
    expect(source).toContain('expandedBytes += Buffer.byteLength(chunk)');
    expect(source).toContain('expandedBytes > maxExpandedBytes');
  });


  it('preflights every tar entry before extraction', () => {
    expect(source).toContain('assertSafeModelArchiveEntry');
    const preflight = source.indexOf('await tar.t({');
    const extraction = source.indexOf('await tar.x({');
    expect(preflight).toBeGreaterThan(-1);
    expect(extraction).toBeGreaterThan(preflight);
  });
});
