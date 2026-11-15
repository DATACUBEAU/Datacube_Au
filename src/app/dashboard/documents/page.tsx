import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HardDrive, LockKeyhole, Smartphone } from 'lucide-react';

export default function DocumentsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-medium text-primary">AU Documents</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your documents stay on your device</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          DataCube AU is moving document storage, parsing, indexing and retrieval
          to on-device processing. The previous cloud upload and worker pipeline
          has been retired.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Local-first document workspace</CardTitle>
          <CardDescription>
            Cloud document uploads and server-side document processing are no longer available from this web dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <div className="flex items-start gap-3">
            <Smartphone className="mt-1 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium">On-device storage</p>
              <p className="mt-1 text-sm text-muted-foreground">Document files will be managed by the AU app on your device.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <HardDrive className="mt-1 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium">Local indexing</p>
              <p className="mt-1 text-sm text-muted-foreground">Parsing, chunking, embeddings and retrieval are moving on-device.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-1 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium">User-controlled data</p>
              <p className="mt-1 text-sm text-muted-foreground">The target design keeps document files and indexes under your control.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        The Flutter local document workspace is not yet available in this release.
        Existing cloud-stored files have not been deleted as part of this code change.
      </p>
    </main>
  );
}
