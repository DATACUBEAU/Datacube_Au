import type { SupabaseClient } from '@supabase/supabase-js';

type FeedbackRow = {
  id: string;
  created_at: string | null;
  user_id: string | null;
  section: string | null;
  rating: string | number | null;
  comment: string | null;
  metadata: Record<string, unknown> | null;
};

type UserRow = {
  id: string;
  email: string | null;
};

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export type AdminFeedbackRecord = {
  id: string;
  created_at: string | null;
  user_id: string | null;
  section: string;
  rating: string | number | null;
  rating_label: string;
  rating_variant: 'positive' | 'negative' | 'neutral';
  comment: string | null;
  metadata: Record<string, unknown>;
  user_name: string | null;
  user_email: string | null;
  user_avatar_url: string | null;
  user_label: string;
};

function shortUserId(value: string | null): string {
  if (!value) return 'Anonymous';
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

function ratingVariant(value: string | number | null): AdminFeedbackRecord['rating_variant'] {
  if (typeof value === 'number') {
    if (value >= 4) return 'positive';
    if (value <= 2) return 'negative';
    return 'neutral';
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'positive') return 'positive';
  if (normalized === 'negative') return 'negative';
  return 'neutral';
}

function ratingLabel(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return `${value}/5`;
  return String(value);
}

function isMissingRelationError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim();
  const message = String((error as any)?.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist') || message.includes('relation');
}

export async function listAdminFeedback(
  supabase: SupabaseClient<any, 'public', any>,
  options?: {
    limit?: number;
    from?: string | null;
    to?: string | null;
  },
): Promise<{ rows: AdminFeedbackRecord[]; count: number }> {
  const limit = Math.min(10000, Math.max(1, Math.floor(options?.limit || 200)));
  let query = supabase
    .from('au_feedback')
    .select('id,created_at,user_id,section,rating,comment,metadata')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options?.from) query = query.gte('created_at', options.from);
  if (options?.to) query = query.lte('created_at', options.to);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const feedbackRows = (data || []) as FeedbackRow[];
  const userIds = Array.from(
    new Set(
      feedbackRows
        .map((row) => (typeof row.user_id === 'string' ? row.user_id : ''))
        .filter(Boolean),
    ),
  );

  const usersById = new Map<string, UserRow>();
  const profilesByUserId = new Map<string, ProfileRow>();

  if (userIds.length > 0) {
    const [usersRes, profilesRes] = await Promise.all([
      supabase.from('au_users').select('id,email').in('id', userIds),
      supabase.from('au_user_profiles').select('user_id,full_name,avatar_url').in('user_id', userIds),
    ]);

    if (!usersRes.error) {
      for (const row of (usersRes.data || []) as UserRow[]) {
        usersById.set(row.id, row);
      }
    } else if (!isMissingRelationError(usersRes.error) && process.env.NODE_ENV !== 'production') {
      console.warn('[admin-feedback] user lookup failed', {
        code: usersRes.error.code,
        message: usersRes.error.message,
      });
    }

    if (!profilesRes.error) {
      for (const row of (profilesRes.data || []) as ProfileRow[]) {
        profilesByUserId.set(row.user_id, row);
      }
    } else if (!isMissingRelationError(profilesRes.error) && process.env.NODE_ENV !== 'production') {
      console.warn('[admin-feedback] profile lookup failed', {
        code: profilesRes.error.code,
        message: profilesRes.error.message,
      });
    }
  }

  const rows = feedbackRows.map((row) => {
    const profile = row.user_id ? profilesByUserId.get(row.user_id) : undefined;
    const user = row.user_id ? usersById.get(row.user_id) : undefined;
    const userName = typeof profile?.full_name === 'string' && profile.full_name.trim() ? profile.full_name.trim() : null;
    const userEmail = typeof user?.email === 'string' && user.email.trim() ? user.email.trim() : null;

    return {
      id: row.id,
      created_at: row.created_at,
      user_id: row.user_id,
      section: String(row.section || 'unknown'),
      rating: row.rating ?? null,
      rating_label: ratingLabel(row.rating ?? null),
      rating_variant: ratingVariant(row.rating ?? null),
      comment: row.comment ?? null,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      user_name: userName,
      user_email: userEmail,
      user_avatar_url:
        typeof profile?.avatar_url === 'string' && profile.avatar_url.trim() ? profile.avatar_url.trim() : null,
      user_label: userName || userEmail || shortUserId(row.user_id),
    } satisfies AdminFeedbackRecord;
  });

  if (process.env.NODE_ENV !== 'production') {
    console.debug('[admin-feedback] loaded feedback rows', {
      count: rows.length,
      userCount: userIds.length,
      from: options?.from ?? null,
      to: options?.to ?? null,
    });
  }

  return { rows, count: rows.length };
}
