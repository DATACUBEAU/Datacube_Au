import { NextRequest, NextResponse } from 'next/server';
import { createClient, type User } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';
import {
  ACCOUNT_STATUSES,
  USER_ROLES,
  buildAppMetadataPatch,
  filterManagedUsers,
  normalizeAccountStatus,
  normalizePermissions,
  normalizeUserRole,
  roleToTier,
  type ManagedUserRecord,
  type UserRole,
} from '@/lib/server/admin-user-management';

export const runtime = 'nodejs';

function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function getSupabaseUrl() {
  return firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
}

function getSupabaseAnonKey() {
  return firstEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
}

function getSupabaseServiceRoleKey() {
  return firstEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY');
}

function createServiceRoleClient() {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(
      503,
      'server_misconfigured',
      'Missing SUPABASE_SERVICE_ROLE_KEY. Read-only listing can use au_users fallback, but admin write actions require service role.'
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function tryCreateServiceRoleClient(): ReturnType<typeof createServiceRoleClient> | null {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createScopedRlsClient(accessToken: string): ReturnType<typeof createServiceRoleClient> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    throw new ApiError(503, 'server_misconfigured', 'Missing SUPABASE URL or anon key.');
  }
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as ReturnType<typeof createServiceRoleClient>;
}

function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, details: error.details ?? null },
      { status: error.status }
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'invalid_request', details: error.flatten() },
      { status: 400 }
    );
  }
  return NextResponse.json({ error: 'internal_server_error' }, { status: 500 });
}

type AuthorizedActor = {
  userId: string;
  email: string | null;
  accessToken: string;
};

async function requireConexAdmin(req: NextRequest): Promise<AuthorizedActor> {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    throw new ApiError(401, 'unauthorized');
  }

  const profileClient = tryCreateServiceRoleClient() ?? createScopedRlsClient(auth.accessToken);
  const { data: profile, error } = await profileClient
    .from('au_user_profiles')
    .select('tier')
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, 'profile_lookup_failed', error.message);
  }

  const allowed = hasConexAccess({
    userId: auth.userId,
    email: auth.email ?? null,
    tier: profile?.tier ?? null,
  });

  if (!allowed) {
    throw new ApiError(403, 'forbidden');
  }

  return { userId: auth.userId, email: auth.email ?? null, accessToken: auth.accessToken };
}

type AuthUserResult = {
  users: User[];
  total: number;
};

async function listAllAuthUsers(supabaseAdmin: ReturnType<typeof createServiceRoleClient>): Promise<AuthUserResult> {
  const perPage = 200;
  let page = 1;
  let total = 0;
  const users: User[] = [];

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new ApiError(500, 'list_users_failed', error.message);
    }

    const pageUsers = data?.users ?? [];
    if (typeof data?.total === 'number') total = data.total;
    users.push(...pageUsers);

    if (pageUsers.length < perPage) break;
    if (users.length >= 5000) break;
    page += 1;
  }

  return { users, total: total || users.length };
}

type AuUsersRow = {
  id: string;
  email: string | null;
  provider: string | null;
  created_at: string | null;
  updated_at: string | null;
};

async function listAllAuUsers(
  supabaseClient: ReturnType<typeof createServiceRoleClient>
): Promise<{ rows: AuUsersRow[]; total: number }> {
  const { data, error, count } = await supabaseClient
    .from('au_users')
    .select('id,email,provider,created_at,updated_at', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .limit(5000);

  if (error) {
    throw new ApiError(500, 'au_users_list_failed', error.message);
  }

  const rows = ((data ?? []) as AuUsersRow[]).filter((row) => Boolean(row?.id));
  return {
    rows,
    total: typeof count === 'number' ? count : rows.length,
  };
}

async function fetchProfilesMap(
  supabaseAdmin: ReturnType<typeof createServiceRoleClient>,
  userIds: string[]
): Promise<Map<string, { tier: string | null; full_name: string | null; avatar_url: string | null }>> {
  if (userIds.length === 0) return new Map();
  const map = new Map<string, { tier: string | null; full_name: string | null; avatar_url: string | null }>();

  for (let i = 0; i < userIds.length; i += 500) {
    const chunk = userIds.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from('au_user_profiles')
      .select('user_id,tier,full_name,avatar_url')
      .in('user_id', chunk);

    if (error) {
      throw new ApiError(500, 'profile_list_failed', error.message);
    }

    for (const row of data ?? []) {
      map.set(row.user_id as string, {
        tier: (row as any).tier ?? null,
        full_name: (row as any).full_name ?? null,
        avatar_url: (row as any).avatar_url ?? null,
      });
    }
  }

  return map;
}

async function fetchActivityMap(
  supabaseAdmin: ReturnType<typeof createServiceRoleClient>,
  userIds: string[]
): Promise<Map<string, { last_active_at: string | null; metadata: any; is_pwa: boolean; user_agent: string | null }>> {
  if (userIds.length === 0) return new Map();
  const map = new Map<string, { last_active_at: string | null; metadata: any; is_pwa: boolean; user_agent: string | null }>();

  for (let i = 0; i < userIds.length; i += 500) {
    const chunk = userIds.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from('au_user_activity')
      .select('user_id,last_active_at,metadata,is_pwa,user_agent')
      .in('user_id', chunk);

    if (error) {
      if ((error as any).code === '42P01' || String(error.message || '').toLowerCase().includes('does not exist')) {
        return map;
      }
      throw new ApiError(500, 'activity_list_failed', error.message);
    }

    for (const row of data ?? []) {
      map.set((row as any).user_id, {
        last_active_at: (row as any).last_active_at ?? null,
        metadata: (row as any).metadata ?? null,
        is_pwa: Boolean((row as any).is_pwa),
        user_agent: (row as any).user_agent ?? null,
      });
    }
  }

  return map;
}

function mapAuthUserToManagedRecord(
  user: User,
  profile: { tier: string | null; full_name: string | null; avatar_url: string | null } | undefined,
  activity: { last_active_at: string | null; metadata: any; is_pwa: boolean; user_agent: string | null } | undefined
): ManagedUserRecord {
  const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const userMeta = (user.user_metadata ?? {}) as Record<string, unknown>;

  const role = normalizeUserRole(appMeta.role ?? profile?.tier ?? 'user');
  const statusFromApp = appMeta.account_status;
  const bannedUntilRaw = (user as any).banned_until as string | null | undefined;
  const isBanned = Boolean(bannedUntilRaw && new Date(bannedUntilRaw).getTime() > Date.now());
  const accountStatus = isBanned
    ? 'suspended'
    : normalizeAccountStatus(statusFromApp ?? 'active');

  const permissions = normalizePermissions(appMeta.permissions);
  const fullName =
    profile?.full_name ||
    String(userMeta.full_name ?? userMeta.name ?? '').trim() ||
    null;
  const avatarUrl =
    profile?.avatar_url ||
    String(userMeta.avatar_url ?? '').trim() ||
    null;

  const tier = profile?.tier ?? roleToTier(role) ?? 'free';
  const isAuthorized = String(tier).toLowerCase() === 'admin';

  return {
    user_id: user.id,
    email: user.email ?? null,
    full_name: fullName,
    avatar_url: avatarUrl,
    provider: String((user as any).app_metadata?.provider ?? 'supabase'),
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    last_active_at: activity?.last_active_at ?? user.last_sign_in_at ?? null,
    account_status: accountStatus,
    role,
    tier,
    permissions,
    is_suspended: accountStatus === 'suspended',
    is_authorized: isAuthorized,
  };
}

function mapAuUsersToManagedRecord(
  user: AuUsersRow,
  profile: { tier: string | null; full_name: string | null; avatar_url: string | null } | undefined,
  activity: { last_active_at: string | null; metadata: any; is_pwa: boolean; user_agent: string | null } | undefined
): ManagedUserRecord {
  const role = normalizeUserRole(profile?.tier ?? 'user');
  const tier = profile?.tier ?? roleToTier(role) ?? 'free';
  const permissions = normalizePermissions((activity?.metadata as Record<string, unknown> | null)?.permissions);
  const accountStatus = normalizeAccountStatus(
    (activity?.metadata as Record<string, unknown> | null)?.account_status ?? 'active'
  );
  const isAuthorized = String(tier).toLowerCase() === 'admin';

  return {
    user_id: user.id,
    email: user.email ?? null,
    full_name: profile?.full_name ?? null,
    avatar_url: profile?.avatar_url ?? null,
    provider: user.provider ?? 'supabase',
    created_at: user.created_at ?? null,
    last_sign_in_at: null,
    last_active_at: activity?.last_active_at ?? user.updated_at ?? user.created_at ?? null,
    account_status: accountStatus,
    role,
    tier,
    permissions,
    is_suspended: accountStatus === 'suspended',
    is_authorized: isAuthorized,
  };
}

function temporaryPassword() {
  return `DcAu#${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

const querySchema = z.object({
  q: z.string().optional(),
  status: z.enum(['all', ...ACCOUNT_STATUSES]).optional().default('all'),
  role: z.enum(['all', ...USER_ROLES]).optional().default('all'),
  sortBy: z.enum(['created_at', 'last_active_at', 'email', 'full_name']).optional().default('last_active_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

const createUserSchema = z.object({
  action: z.literal('create_user'),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128).optional(),
  fullName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(USER_ROLES).optional().default('user'),
  status: z.enum(ACCOUNT_STATUSES).optional().default('active'),
  permissions: z.array(z.string().trim().min(1).max(64)).optional().default([]),
});

const updateUserSchema = z.object({
  action: z.literal('update_user'),
  userId: z.string().uuid(),
  fullName: z.string().trim().max(120).optional(),
  avatarUrl: z.string().url().or(z.literal('')).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(USER_ROLES).optional(),
  permissions: z.array(z.string().trim().min(1).max(64)).optional(),
  tier: z.enum(['admin', 'free', 'weekly', 'monthly']).optional(),
});

const deleteUserSchema = z.object({
  action: z.literal('delete_user'),
  userId: z.string().uuid(),
});

const resetPasswordSchema = z.object({
  action: z.literal('reset_password'),
  userId: z.string().uuid(),
});

const bulkUpdateSchema = z.object({
  action: z.literal('bulk_update_users'),
  userIds: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(USER_ROLES).optional(),
  permissions: z.array(z.string().trim().min(1).max(64)).optional(),
});

const bulkDeleteSchema = z.object({
  action: z.literal('bulk_delete_users'),
  userIds: z.array(z.string().uuid()).min(1).max(200),
});

const activitySchema = z.object({
  action: z.literal('get_user_activity'),
  userId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

const actionsSchema = z.discriminatedUnion('action', [
  createUserSchema,
  updateUserSchema,
  deleteUserSchema,
  resetPasswordSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
  activitySchema,
]);

async function listManagedUsers(req: NextRequest) {
  const actor = await requireConexAdmin(req);
  const queryInput = querySchema.parse({
    q: req.nextUrl.searchParams.get('q') ?? undefined,
    status: req.nextUrl.searchParams.get('status') ?? undefined,
    role: req.nextUrl.searchParams.get('role') ?? undefined,
    sortBy: req.nextUrl.searchParams.get('sortBy') ?? undefined,
    sortDir: req.nextUrl.searchParams.get('sortDir') ?? undefined,
    page: req.nextUrl.searchParams.get('page') ?? undefined,
    pageSize: req.nextUrl.searchParams.get('pageSize') ?? undefined,
  });

  const serviceClient = tryCreateServiceRoleClient();
  let merged: ManagedUserRecord[] = [];
  let totalUsers = 0;

  if (serviceClient) {
    const { users: authUsers, total } = await listAllAuthUsers(serviceClient);
    const userIds = authUsers.map((user) => user.id);
    const [profilesMap, activityMap] = await Promise.all([
      fetchProfilesMap(serviceClient, userIds),
      fetchActivityMap(serviceClient, userIds),
    ]);

    merged = authUsers.map((user) =>
      mapAuthUserToManagedRecord(user, profilesMap.get(user.id), activityMap.get(user.id))
    );
    totalUsers = total;
  } else {
    const scopedClient = createScopedRlsClient(actor.accessToken);
    const { rows, total } = await listAllAuUsers(scopedClient);
    const userIds = rows.map((row) => row.id);
    const [profilesMap, activityMap] = await Promise.all([
      fetchProfilesMap(scopedClient, userIds),
      fetchActivityMap(scopedClient, userIds),
    ]);

    merged = rows.map((row) =>
      mapAuUsersToManagedRecord(row, profilesMap.get(row.id), activityMap.get(row.id))
    );
    totalUsers = total;
  }

  const filtered = filterManagedUsers(merged, {
    q: queryInput.q ?? '',
    status: queryInput.status,
    role: queryInput.role,
    sortBy: queryInput.sortBy,
    sortDir: queryInput.sortDir,
  });

  const filteredTotal = filtered.length;
  const start = (queryInput.page - 1) * queryInput.pageSize;
  const paged = filtered.slice(start, start + queryInput.pageSize);

  return NextResponse.json({
    ok: true,
    users: paged,
    totalUsers,
    filteredTotal,
    page: queryInput.page,
    pageSize: queryInput.pageSize,
    source: serviceClient ? 'auth_admin' : 'au_users_fallback',
  });
}

async function updateSingleUser(
  supabaseAdmin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  patch: {
    fullName?: string;
    avatarUrl?: string;
    status?: (typeof ACCOUNT_STATUSES)[number];
    role?: UserRole;
    permissions?: string[];
    tier?: 'admin' | 'free' | 'weekly' | 'monthly';
  }
) {
  const userRes = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userRes.error || !userRes.data.user) {
    throw new ApiError(404, 'user_not_found', userRes.error?.message ?? 'User not found.');
  }

  const current = userRes.data.user;
  const nextAppMetadata = buildAppMetadataPatch(current.app_metadata as Record<string, unknown>, {
    status: patch.status,
    role: patch.role,
    permissions: patch.permissions,
  });

  const nextUserMetadata: Record<string, unknown> = { ...(current.user_metadata as Record<string, unknown> ?? {}) };
  if (patch.fullName !== undefined) nextUserMetadata.full_name = patch.fullName || null;
  if (patch.avatarUrl !== undefined) nextUserMetadata.avatar_url = patch.avatarUrl || null;

  const updatePayload: Record<string, unknown> = {
    app_metadata: nextAppMetadata,
    user_metadata: nextUserMetadata,
  };

  if (patch.status === 'suspended') {
    updatePayload.ban_duration = '876000h';
  } else if (patch.status === 'active' || patch.status === 'inactive') {
    updatePayload.ban_duration = 'none';
  }

  const updateRes = await supabaseAdmin.auth.admin.updateUserById(userId, updatePayload as any);
  if (updateRes.error) {
    throw new ApiError(500, 'user_update_failed', updateRes.error.message);
  }

  const tierFromRole = patch.role ? roleToTier(patch.role) : null;
  const profilePatch: Record<string, unknown> = { user_id: userId };
  if (patch.fullName !== undefined) profilePatch.full_name = patch.fullName || null;
  if (patch.avatarUrl !== undefined) profilePatch.avatar_url = patch.avatarUrl || null;
  if (patch.tier) profilePatch.tier = patch.tier;
  else if (tierFromRole) profilePatch.tier = tierFromRole;

  if (Object.keys(profilePatch).length > 1) {
    const profileRes = await supabaseAdmin
      .from('au_user_profiles')
      .upsert(profilePatch, { onConflict: 'user_id' });
    if (profileRes.error) {
      throw new ApiError(500, 'profile_update_failed', profileRes.error.message);
    }
  }
}

async function handleCreateUser(payload: z.infer<typeof createUserSchema>, supabaseAdmin: ReturnType<typeof createServiceRoleClient>) {
  const normalizedPermissions = normalizePermissions(payload.permissions);
  const normalizedRole = normalizeUserRole(payload.role, 'user');
  const normalizedStatus = normalizeAccountStatus(payload.status, 'active');
  const tier = roleToTier(normalizedRole) ?? 'free';

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: payload.email,
    password: payload.password || temporaryPassword(),
    email_confirm: true,
    app_metadata: {
      role: normalizedRole,
      account_status: normalizedStatus,
      permissions: normalizedPermissions,
    },
    user_metadata: {
      full_name: payload.fullName ?? null,
    },
  });

  if (error || !data.user?.id) {
    throw new ApiError(500, 'create_user_failed', error?.message ?? 'Unable to create user.');
  }

  const userId = data.user.id;

  const auUsersWrite = await supabaseAdmin
    .from('au_users')
    .upsert(
      {
        id: userId,
        provider: 'supabase',
        provider_uid: userId,
        email: payload.email,
      } as any,
      { onConflict: 'id' }
    );
  if (auUsersWrite.error) {
    throw new ApiError(500, 'au_users_upsert_failed', auUsersWrite.error.message);
  }

  const profileWrite = await supabaseAdmin
    .from('au_user_profiles')
    .upsert(
      {
        user_id: userId,
        full_name: payload.fullName ?? null,
        tier,
      } as any,
      { onConflict: 'user_id' }
    );
  if (profileWrite.error) {
    throw new ApiError(500, 'profile_upsert_failed', profileWrite.error.message);
  }

  return NextResponse.json({ ok: true, userId, email: payload.email });
}

async function handleDeleteUser(userId: string, supabaseAdmin: ReturnType<typeof createServiceRoleClient>) {
  await supabaseAdmin.from('au_user_activity').delete().eq('user_id', userId);
  await supabaseAdmin.from('au_messages').delete().eq('user_id', userId);
  await supabaseAdmin.from('au_sessions').delete().eq('user_id', userId);
  await supabaseAdmin.from('au_user_profiles').delete().eq('user_id', userId);
  await supabaseAdmin.from('au_users').delete().eq('id', userId);

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    throw new ApiError(500, 'delete_user_failed', error.message);
  }

  return NextResponse.json({ ok: true, userId });
}

async function handleResetPassword(userId: string, supabaseAdmin: ReturnType<typeof createServiceRoleClient>) {
  const userRes = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userRes.error || !userRes.data.user) {
    throw new ApiError(404, 'user_not_found', userRes.error?.message ?? 'User not found.');
  }

  const email = userRes.data.user.email;
  if (!email) {
    throw new ApiError(400, 'missing_email', 'User does not have a recoverable email.');
  }

  const linkRes = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
  });

  if (linkRes.error) {
    throw new ApiError(500, 'password_reset_failed', linkRes.error.message);
  }

  return NextResponse.json({
    ok: true,
    email,
    actionLink: linkRes.data?.properties?.action_link ?? null,
  });
}

async function handleUserActivity(
  payload: z.infer<typeof activitySchema>,
  supabaseAdmin: ReturnType<typeof createServiceRoleClient>
) {
  const logs: Array<{ id: string; kind: string; created_at: string; details: unknown }> = [];

  const eventsRes = await supabaseAdmin
    .from('au_events')
    .select('id,event_type,timestamp,metadata')
    .eq('user_id', payload.userId)
    .order('timestamp', { ascending: false })
    .limit(payload.limit);

  if (!eventsRes.error && eventsRes.data) {
    for (const row of eventsRes.data) {
      logs.push({
        id: String((row as any).id ?? crypto.randomUUID()),
        kind: String((row as any).event_type ?? 'event'),
        created_at: String((row as any).timestamp ?? new Date().toISOString()),
        details: (row as any).metadata ?? null,
      });
    }
  }

  const activityRes = await supabaseAdmin
    .from('au_user_activity')
    .select('last_active_at,metadata,is_pwa,user_agent')
    .eq('user_id', payload.userId)
    .maybeSingle();

  if (!activityRes.error && activityRes.data?.last_active_at) {
    logs.push({
      id: `activity-${payload.userId}`,
      kind: 'heartbeat',
      created_at: String(activityRes.data.last_active_at),
      details: {
        metadata: (activityRes.data as any).metadata ?? null,
        is_pwa: Boolean((activityRes.data as any).is_pwa),
        user_agent: (activityRes.data as any).user_agent ?? null,
      },
    });
  }

  logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({ ok: true, logs: logs.slice(0, payload.limit) });
}

export async function GET(req: NextRequest) {
  try {
    return await listManagedUsers(req);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireConexAdmin(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError(400, 'invalid_body', 'Expected JSON body.');
    }

    const payload = actionsSchema.parse(body);
    if (payload.action === 'get_user_activity') {
      const readClient = tryCreateServiceRoleClient() ?? createScopedRlsClient(actor.accessToken);
      return await handleUserActivity(payload, readClient);
    }

    const supabaseAdmin = createServiceRoleClient();

    if (payload.action === 'create_user') {
      return await handleCreateUser(payload, supabaseAdmin);
    }

    if (payload.action === 'update_user') {
      await updateSingleUser(supabaseAdmin, payload.userId, {
        fullName: payload.fullName,
        avatarUrl: payload.avatarUrl,
        status: payload.status,
        role: payload.role,
        permissions: payload.permissions,
        tier: payload.tier,
      });
      return NextResponse.json({ ok: true, userId: payload.userId });
    }

    if (payload.action === 'delete_user') {
      return await handleDeleteUser(payload.userId, supabaseAdmin);
    }

    if (payload.action === 'reset_password') {
      return await handleResetPassword(payload.userId, supabaseAdmin);
    }

    if (payload.action === 'bulk_update_users') {
      const failures: Array<{ userId: string; error: string }> = [];
      let successCount = 0;

      for (const userId of payload.userIds) {
        try {
          await updateSingleUser(supabaseAdmin, userId, {
            status: payload.status,
            role: payload.role,
            permissions: payload.permissions,
          });
          successCount += 1;
        } catch (error: any) {
          failures.push({ userId, error: String(error?.message || 'update_failed') });
        }
      }

      return NextResponse.json({ ok: failures.length === 0, successCount, failures });
    }

    if (payload.action === 'bulk_delete_users') {
      const failures: Array<{ userId: string; error: string }> = [];
      let successCount = 0;

      for (const userId of payload.userIds) {
        try {
          await handleDeleteUser(userId, supabaseAdmin);
          successCount += 1;
        } catch (error: any) {
          failures.push({ userId, error: String(error?.message || 'delete_failed') });
        }
      }

      return NextResponse.json({ ok: failures.length === 0, successCount, failures });
    }

    throw new ApiError(400, 'unsupported_action');
  } catch (error) {
    return jsonError(error);
  }
}
