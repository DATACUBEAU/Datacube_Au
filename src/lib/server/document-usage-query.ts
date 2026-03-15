export type DocumentUsageRow = {
  id: string;
  file_size_bytes: number | null;
  created_at: string | null;
  status: string | null;
};

type DocumentUsageClient = {
  from: (table: string) => any;
};

function isSchemaDriftError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('does not exist') ||
    details.includes('does not exist')
  );
}

function mapDocumentUsageRowsWithoutFileSize(
  rows: Array<Record<string, unknown>>,
): DocumentUsageRow[] {
  return rows.map((row) => ({
    id: String(row.id),
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    file_size_bytes: null,
    status: typeof row.status === 'string' ? row.status : null,
  }));
}

export async function safeSelectDocuments(
  supabase: DocumentUsageClient,
  userId: string,
): Promise<DocumentUsageRow[]> {
  const columnsWithFileSize = 'id,file_size_bytes,created_at,status';
  const columnsWithoutFileSize = 'id,created_at,status';
  const ownerOrUserFilter = `owner_id.eq.${userId},user_id.eq.${userId}`;

  const ownerOrUserWithFileSize = await supabase
    .from('au_documents')
    .select(columnsWithFileSize)
    .or(ownerOrUserFilter);

  if (!ownerOrUserWithFileSize.error) {
    return (ownerOrUserWithFileSize.data || []) as DocumentUsageRow[];
  }
  if (!isSchemaDriftError(ownerOrUserWithFileSize.error)) {
    throw ownerOrUserWithFileSize.error;
  }

  const ownerOrUserWithoutFileSize = await supabase
    .from('au_documents')
    .select(columnsWithoutFileSize)
    .or(ownerOrUserFilter);

  if (!ownerOrUserWithoutFileSize.error) {
    return mapDocumentUsageRowsWithoutFileSize(ownerOrUserWithoutFileSize.data || []);
  }
  if (!isSchemaDriftError(ownerOrUserWithoutFileSize.error)) {
    throw ownerOrUserWithoutFileSize.error;
  }

  const userOnlyWithFileSize = await supabase
    .from('au_documents')
    .select(columnsWithFileSize)
    .eq('user_id', userId);

  if (!userOnlyWithFileSize.error) {
    return (userOnlyWithFileSize.data || []) as DocumentUsageRow[];
  }
  if (!isSchemaDriftError(userOnlyWithFileSize.error)) {
    throw userOnlyWithFileSize.error;
  }

  const userOnlyWithoutFileSize = await supabase
    .from('au_documents')
    .select(columnsWithoutFileSize)
    .eq('user_id', userId);

  if (!userOnlyWithoutFileSize.error) {
    return mapDocumentUsageRowsWithoutFileSize(userOnlyWithoutFileSize.data || []);
  }
  if (isSchemaDriftError(userOnlyWithoutFileSize.error)) {
    return [];
  }
  throw userOnlyWithoutFileSize.error;
}
