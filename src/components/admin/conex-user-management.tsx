'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, RefreshCw, Search, ShieldPlus, Trash2, UserPlus, Users } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';
import { dispatchAccountSnapshotInvalidated } from '@/components/providers/account-snapshot-provider';
import { adminOverridePlanLabel, type AdminOverridePlan } from '@/lib/admin/protected-owner';
import {
  ADMIN_ASSIGNABLE_PLAN_KEYS,
  adminAssignablePlanLabel,
  normalizeAdminAssignablePlan,
  resolveAdminPlanChangeType,
  type AdminAssignablePlanKey,
  type AdminPlanChangeType,
} from '@/lib/server/admin-user-management';

type AccountStatus = 'active' | 'inactive' | 'suspended';
type UserRole = 'admin' | 'free' | 'weekly' | 'monthly' | 'pro' | 'user';
type PresenceFilter = 'all' | 'online' | 'offline';

type ManagedUser = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  last_active_at: string | null;
  account_status: AccountStatus;
  role: UserRole;
  tier: string | null;
  permissions: string[];
  is_suspended: boolean;
  is_authorized: boolean;
  is_protected_owner?: boolean;
  admin_override_plan?: AdminOverridePlan | null;
};

type ActivityLog = {
  id: string;
  kind: string;
  created_at: string;
  details: unknown;
};

const STATUS_OPTIONS: Array<{ label: string; value: AccountStatus | 'all' }> = [
  { label: 'All statuses', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Suspended', value: 'suspended' },
];

const ROLE_OPTIONS: Array<{ label: string; value: UserRole | 'all' }> = [
  { label: 'All roles', value: 'all' },
  { label: 'Admin', value: 'admin' },
  { label: 'Free', value: 'free' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Pro', value: 'pro' },
  { label: 'User', value: 'user' },
];

const PRESENCE_OPTIONS: Array<{ label: string; value: PresenceFilter }> = [
  { label: 'All presence', value: 'all' },
  { label: 'Online now', value: 'online' },
  { label: 'Offline', value: 'offline' },
];

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function isOnlineNow(value: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= ONLINE_WINDOW_MS;
}

function formatLastSeen(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'Just now';
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error('Session expired. Sign in again.');

  const headers = new Headers(init?.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  return fetch(input, { ...init, headers, cache: 'no-store' });
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const payload = await res.json().catch(() => null);
  const message =
    (payload && typeof payload === 'object' && (payload as any).details?.message) ||
    (payload && typeof payload === 'object' && typeof (payload as any).details === 'string' && (payload as any).details) ||
    (payload && typeof payload === 'object' && (payload as any).message) ||
    (payload && typeof payload === 'object' && (payload as any).error) ||
    fallback;
  return new Error(String(message));
}

export function ConexUserManagement() {
  const { toast } = useToast();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [sourceMode, setSourceMode] = useState<'auth_admin' | 'au_users_fallback'>('auth_admin');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AccountStatus | 'all'>('all');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUser = useMemo(() => users.find((u) => u.user_id === selectedUserId) ?? null, [users, selectedUserId]);

  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [status, setStatus] = useState<AccountStatus>('active');
  const [role, setRole] = useState<UserRole>('user');
  const [permissionsText, setPermissionsText] = useState('');
  const [savingUser, setSavingUser] = useState(false);
  const [deletingUser, setDeletingUser] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [adminOverridePlan, setAdminOverridePlan] = useState<AdminAssignablePlanKey>('pro_monthly');
  const [savingAdminOverride, setSavingAdminOverride] = useState(false);
  const [pendingPlanChange, setPendingPlanChange] = useState<{
    targetPlan: AdminAssignablePlanKey;
    changeType: AdminPlanChangeType;
  } | null>(null);

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const [bulkStatus, setBulkStatus] = useState<AccountStatus | ''>('');
  const [bulkRole, setBulkRole] = useState<UserRole | ''>('');
  const [bulkPermissions, setBulkPermissions] = useState('');
  const [runningBulk, setRunningBulk] = useState(false);

  const [creatingUser, setCreatingUser] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createFullName, setCreateFullName] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('user');
  const [createStatus, setCreateStatus] = useState<AccountStatus>('active');
  const [createPermissions, setCreatePermissions] = useState('');

  const fetchUsers = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      if (!silent) setLoadingUsers(true);
      if (silent) setRefreshing(true);
      if (!silent) setLoadError(null);

      try {
        const params = new URLSearchParams({
          q: search,
          status: statusFilter,
          role: roleFilter,
          presence: presenceFilter,
          page: String(page),
          pageSize: String(pageSize),
          sortBy: 'last_active_at',
          sortDir: 'desc',
        });

        const res = await authedFetch(`/api/admin/users?${params.toString()}`);
        if (!res.ok) throw await parseError(res, 'Failed to load users.');
        const payload = await res.json();

        const nextUsers = Array.isArray(payload.users) ? (payload.users as ManagedUser[]) : [];
        setUsers(nextUsers);
        setTotalUsers(Number(payload.totalUsers || 0));
        setFilteredTotal(Number(payload.filteredTotal || 0));
        setSourceMode(payload.source === 'au_users_fallback' ? 'au_users_fallback' : 'auth_admin');
        setLoadError(null);

        if (process.env.NODE_ENV !== 'production') {
          console.debug('[ConexUserManagement] loaded users', {
            count: nextUsers.length,
            totalUsers: Number(payload.totalUsers || 0),
            filteredTotal: Number(payload.filteredTotal || 0),
            source: payload.source,
          });
        }

        if (nextUsers.length === 0) {
          setSelectedUserId(null);
          setSelectedIds(new Set());
        } else if (!selectedUserId || !nextUsers.find((row) => row.user_id === selectedUserId)) {
          setSelectedUserId(nextUsers[0].user_id);
        }
      } catch (error: any) {
        const message = error?.message || 'Unable to load users.';
        setLoadError(message);
        toast({
          title: 'User list failed',
          description: message,
          variant: 'destructive',
        });
      } finally {
        if (!silent) setLoadingUsers(false);
        if (silent) setRefreshing(false);
      }
    },
    [page, presenceFilter, roleFilter, search, selectedUserId, statusFilter, toast]
  );

  const fetchActivity = useCallback(
    async (userId: string) => {
      setLoadingActivity(true);
      try {
        const res = await authedFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            action: 'get_user_activity',
            userId,
            limit: 30,
          }),
        });
        if (!res.ok) throw await parseError(res, 'Failed to load activity logs.');
        const payload = await res.json();
        setActivityLogs(Array.isArray(payload.logs) ? payload.logs : []);
      } catch (error: any) {
        setActivityLogs([]);
        toast({
          title: 'Activity log failed',
          description: error?.message || 'Unable to fetch activity logs.',
          variant: 'destructive',
        });
      } finally {
        setLoadingActivity(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, roleFilter, presenceFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (!selectedUser?.user_id) {
      setActivityLogs([]);
      setFullName('');
      setAvatarUrl('');
      setStatus('active');
      setRole('user');
      setPermissionsText('');
      return;
    }

    setFullName(selectedUser.full_name || '');
    setAvatarUrl(selectedUser.avatar_url || '');
    setStatus(selectedUser.account_status);
    setRole(selectedUser.role);
    setPermissionsText((selectedUser.permissions || []).join(', '));
    setAdminOverridePlan(
      normalizeAdminAssignablePlan(selectedUser.admin_override_plan || selectedUser.tier || selectedUser.role) || 'free',
    );
    fetchActivity(selectedUser.user_id).catch(() => {});
  }, [fetchActivity, selectedUser]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      fetchUsers({ silent: true }).catch(() => {});
      if (selectedUserId) {
        fetchActivity(selectedUserId).catch(() => {});
      }
    }, 45_000);
    return () => clearInterval(interval);
  }, [fetchActivity, fetchUsers, selectedUserId]);

  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const selectedCount = selectedIds.size;
  const protectedUserIds = useMemo(
    () => new Set(users.filter((user) => user.is_protected_owner).map((user) => user.user_id)),
    [users],
  );
  const selectableUserIds = useMemo(
    () => users.filter((user) => !user.is_protected_owner).map((user) => user.user_id),
    [users],
  );
  const isReadOnlyMode = sourceMode === 'au_users_fallback';
  const onlineNowCount = useMemo(
    () => users.filter((user) => isOnlineNow(user.last_active_at)).length,
    [users]
  );
  const offlineCount = Math.max(0, users.length - onlineNowCount);
  const selectedUserIsProtectedOwner = Boolean(
    selectedUser?.is_protected_owner,
  );
  const selectedUserCurrentPlan = useMemo<AdminAssignablePlanKey>(() => {
    if (!selectedUser) return 'free';
    return normalizeAdminAssignablePlan(selectedUser.admin_override_plan || selectedUser.tier || selectedUser.role) || 'free';
  }, [selectedUser]);
  const selectedPlanChangeType = useMemo(
    () => resolveAdminPlanChangeType({
      previousPlan: selectedUserCurrentPlan,
      targetPlan: adminOverridePlan,
    }),
    [adminOverridePlan, selectedUserCurrentPlan],
  );

  const canRunBulk = selectedCount > 0 && !runningBulk;
  const hasBulkPatch = Boolean(bulkStatus || bulkRole || bulkPermissions.trim());

  const toggleSelectUser = useCallback((userId: string, checked: boolean) => {
    if (protectedUserIds.has(userId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }, [protectedUserIds]);

  const toggleSelectAllOnPage = useCallback((checked: boolean) => {
    if (checked) setSelectedIds(new Set(selectableUserIds));
    else setSelectedIds(new Set());
  }, [selectableUserIds]);

  const onSaveUser = useCallback(async () => {
    if (!selectedUser?.user_id) return;
    setSavingUser(true);
    try {
      const permissions = permissionsText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const res = await authedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_user',
          userId: selectedUser.user_id,
          fullName,
          avatarUrl,
          status,
          role,
          permissions,
        }),
      });

      if (!res.ok) throw await parseError(res, 'Failed to save user.');

      toast({ title: 'Saved', description: 'User profile updated.' });
      await fetchUsers({ silent: true });
      await fetchActivity(selectedUser.user_id);
    } catch (error: any) {
      toast({
        title: 'Update failed',
        description: error?.message || 'Could not update user.',
        variant: 'destructive',
      });
    } finally {
      setSavingUser(false);
    }
  }, [avatarUrl, fetchActivity, fetchUsers, fullName, permissionsText, role, selectedUser?.user_id, status, toast]);

  const onDeleteUser = useCallback(async () => {
    if (!selectedUser?.user_id) return;
    const confirmed = window.confirm(`Delete user ${selectedUser.email || selectedUser.user_id}?`);
    if (!confirmed) return;

    setDeletingUser(true);
    try {
      const res = await authedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete_user',
          userId: selectedUser.user_id,
        }),
      });
      if (!res.ok) throw await parseError(res, 'Failed to delete user.');

      toast({ title: 'Deleted', description: 'User account removed.' });
      setSelectedUserId(null);
      setSelectedIds(new Set());
      await fetchUsers({ silent: true });
    } catch (error: any) {
      toast({
        title: 'Delete failed',
        description: error?.message || 'Could not delete user.',
        variant: 'destructive',
      });
    } finally {
      setDeletingUser(false);
    }
  }, [fetchUsers, selectedUser?.email, selectedUser?.user_id, toast]);

  const onResetPassword = useCallback(async () => {
    if (!selectedUser?.user_id) return;
    setResettingPassword(true);
    try {
      const res = await authedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reset_password',
          userId: selectedUser.user_id,
        }),
      });
      if (!res.ok) throw await parseError(res, 'Failed to generate reset link.');
      const payload = await res.json();
      const actionLink = payload.actionLink ? `\n\nReset link:\n${payload.actionLink}` : '';
      toast({
        title: 'Password reset ready',
        description: `Recovery link generated for ${payload.email || selectedUser.email || selectedUser.user_id}.${actionLink}`,
      });
    } catch (error: any) {
      toast({
        title: 'Reset failed',
        description: error?.message || 'Could not create password reset link.',
        variant: 'destructive',
      });
    } finally {
      setResettingPassword(false);
    }
  }, [selectedUser?.email, selectedUser?.user_id, toast]);

  const applyAdminPlanChange = useCallback(async (targetPlan: AdminAssignablePlanKey) => {
    if (!selectedUser?.user_id) return;
    setSavingAdminOverride(true);
    try {
      const res = await authedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_user_plan',
          userId: selectedUser.user_id,
          targetPlan,
          reason: 'conex_user_management',
        }),
      });
      if (!res.ok) throw await parseError(res, 'Failed to update user plan.');
      const payload = await res.json().catch(() => null);
      const changeType = String(payload?.changeType || selectedPlanChangeType);
      dispatchAccountSnapshotInvalidated({
        userId: String(payload?.cacheInvalidation?.userId || selectedUser.user_id),
        reason: 'admin-plan-assignment',
      });

      toast({
        title: changeType === 'reassignment' ? 'Plan refreshed' : 'Plan updated',
        description: `${selectedUser.email || selectedUser.user_id} is now on ${adminAssignablePlanLabel(targetPlan)}. Billing-provider records were not changed.`,
      });
      await fetchUsers({ silent: true });
      await fetchActivity(selectedUser.user_id);
    } catch (error: any) {
      toast({
        title: 'Plan update failed',
        description: error?.message || 'Could not update user plan.',
        variant: 'destructive',
      });
    } finally {
      setSavingAdminOverride(false);
    }
  }, [fetchActivity, fetchUsers, selectedPlanChangeType, selectedUser?.email, selectedUser?.user_id, toast]);

  const onRequestAdminPlanChange = useCallback(() => {
    if (!selectedUser?.user_id) return;
    const changeType = resolveAdminPlanChangeType({
      previousPlan: selectedUserCurrentPlan,
      targetPlan: adminOverridePlan,
    });
    if (changeType === 'downgrade') {
      setPendingPlanChange({ targetPlan: adminOverridePlan, changeType });
      return;
    }
    void applyAdminPlanChange(adminOverridePlan);
  }, [adminOverridePlan, applyAdminPlanChange, selectedUser?.user_id, selectedUserCurrentPlan]);

  const onRunBulkUpdate = useCallback(async () => {
    if (!canRunBulk || !hasBulkPatch) return;

    setRunningBulk(true);
    try {
      const permissions = bulkPermissions
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const res = await authedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'bulk_update_users',
          userIds: [...selectedIds],
          status: bulkStatus || undefined,
          role: bulkRole || undefined,
          permissions: permissions.length > 0 ? permissions : undefined,
        }),
      });
      if (!res.ok) throw await parseError(res, 'Bulk update failed.');
      const payload = await res.json();

      toast({
        title: 'Bulk update completed',
        description: `${payload.successCount || 0} users updated${payload.failures?.length ? `, ${payload.failures.length} failed.` : '.'}`,
      });

      await fetchUsers({ silent: true });
      setSelectedIds(new Set());
      setBulkStatus('');
      setBulkRole('');
      setBulkPermissions('');
    } catch (error: any) {
      toast({
        title: 'Bulk update failed',
        description: error?.message || 'Unable to update selected users.',
        variant: 'destructive',
      });
    } finally {
      setRunningBulk(false);
    }
  }, [bulkPermissions, bulkRole, bulkStatus, canRunBulk, fetchUsers, hasBulkPatch, selectedIds, toast]);

  const onRunBulkDelete = useCallback(async () => {
    if (!canRunBulk) return;
    const confirmed = window.confirm(`Delete ${selectedIds.size} selected users?`);
    if (!confirmed) return;

    setRunningBulk(true);
    try {
      const res = await authedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'bulk_delete_users',
          userIds: [...selectedIds],
        }),
      });
      if (!res.ok) throw await parseError(res, 'Bulk delete failed.');
      const payload = await res.json();

      toast({
        title: 'Bulk delete completed',
        description: `${payload.successCount || 0} users deleted${payload.failures?.length ? `, ${payload.failures.length} failed.` : '.'}`,
      });

      setSelectedUserId(null);
      setSelectedIds(new Set());
      await fetchUsers({ silent: true });
    } catch (error: any) {
      toast({
        title: 'Bulk delete failed',
        description: error?.message || 'Unable to delete selected users.',
        variant: 'destructive',
      });
    } finally {
      setRunningBulk(false);
    }
  }, [canRunBulk, fetchUsers, selectedIds, toast]);

  const onCreateUser = useCallback(async () => {
    const email = createEmail.trim().toLowerCase();
    if (!email) {
      toast({ title: 'Missing email', description: 'Email is required.', variant: 'destructive' });
      return;
    }

    setCreatingUser(true);
    try {
      const permissions = createPermissions
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const res = await authedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_user',
          email,
          password: createPassword.trim() || undefined,
          fullName: createFullName.trim() || undefined,
          role: createRole,
          status: createStatus,
          permissions,
        }),
      });
      if (!res.ok) throw await parseError(res, 'Failed to create user.');

      toast({ title: 'User created', description: `${email} is ready.` });
      setCreateEmail('');
      setCreatePassword('');
      setCreateFullName('');
      setCreatePermissions('');
      setCreateRole('user');
      setCreateStatus('active');
      await fetchUsers({ silent: true });
    } catch (error: any) {
      toast({
        title: 'Create failed',
        description: error?.message || 'Unable to create user.',
        variant: 'destructive',
      });
    } finally {
      setCreatingUser(false);
    }
  }, [createEmail, createFullName, createPassword, createPermissions, createRole, createStatus, fetchUsers, toast]);

  if (loadingUsers && users.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading user management data...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loadError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">User Management Load Failed</CardTitle>
            <CardDescription className="text-destructive">{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" size="sm" onClick={() => fetchUsers().catch(() => {})}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {isReadOnlyMode && (
        <Card className="border-yellow-500/40 bg-yellow-50/50 dark:bg-yellow-900/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Read-only Admin Mode</CardTitle>
            <CardDescription>
              User listing is loaded from <code>au_users</code> fallback because the server admin credential is missing.
              Create/update/delete/reset actions are disabled until server configuration is fixed.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total users</CardDescription>
            <CardTitle className="text-2xl">{totalUsers}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Filtered users</CardDescription>
            <CardTitle className="text-2xl">{filteredTotal}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Selected users</CardDescription>
            <CardTitle className="text-2xl">{selectedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Online now</CardDescription>
            <CardTitle className="text-2xl text-green-600">{onlineNowCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Offline</CardDescription>
            <CardTitle className="text-2xl text-muted-foreground">{offlineCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">User Directory</CardTitle>
                <CardDescription>Search, filter, and run bulk account actions.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => fetchUsers({ silent: true })} disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-4">
              <div className="relative sm:col-span-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  className="pl-9"
                  placeholder="Search name/email/id"
                />
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as AccountStatus | 'all')}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as UserRole | 'all')}>
                <SelectTrigger>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={presenceFilter} onValueChange={(value) => setPresenceFilter(value as PresenceFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Presence" />
                </SelectTrigger>
                <SelectContent>
                  {PRESENCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2 sm:grid-cols-4">
              <Select value={bulkStatus || 'none'} onValueChange={(value) => setBulkStatus(value === 'none' ? '' : (value as AccountStatus))}>
                <SelectTrigger>
                  <SelectValue placeholder="Bulk status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No status update</SelectItem>
                  <SelectItem value="active">Set active</SelectItem>
                  <SelectItem value="inactive">Set inactive</SelectItem>
                  <SelectItem value="suspended">Set suspended</SelectItem>
                </SelectContent>
              </Select>
              <Select value={bulkRole || 'none'} onValueChange={(value) => setBulkRole(value === 'none' ? '' : (value as UserRole))}>
                <SelectTrigger>
                  <SelectValue placeholder="Bulk role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No role update</SelectItem>
                  {ROLE_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Bulk permissions (comma)"
                value={bulkPermissions}
                onChange={(event) => setBulkPermissions(event.target.value)}
              />
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={onRunBulkUpdate}
                  disabled={!canRunBulk || !hasBulkPatch || isReadOnlyMode}
                >
                  {runningBulk ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldPlus className="h-4 w-4 mr-2" />}
                  Apply
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  onClick={onRunBulkDelete}
                  disabled={!canRunBulk || isReadOnlyMode}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="md:hidden space-y-2">
              {users.length === 0 ? (
                <div className="rounded-lg border p-4 text-center text-sm text-muted-foreground">
                  No users found for current filters.
                </div>
              ) : (
                users.map((user) => (
                  <div
                    key={user.user_id}
                    className={`rounded-lg border p-3 ${selectedUserId === user.user_id ? 'border-primary/50 bg-primary/5' : ''}`}
                    onClick={() => setSelectedUserId(user.user_id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{user.full_name || user.email || 'Unnamed User'}</div>
                        <div className="truncate text-xs text-muted-foreground font-mono">{user.email || user.user_id}</div>
                      </div>
                      <div onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(user.user_id)}
                          onCheckedChange={(value) => toggleSelectUser(user.user_id, Boolean(value))}
                          disabled={Boolean(user.is_protected_owner)}
                          aria-label={`Select ${user.email || user.user_id}`}
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge
                        variant={isOnlineNow(user.last_active_at) ? 'default' : 'secondary'}
                        className={isOnlineNow(user.last_active_at) ? 'bg-green-600 hover:bg-green-600' : ''}
                      >
                        {isOnlineNow(user.last_active_at) ? 'online' : 'offline'}
                      </Badge>
                      <Badge
                        variant={user.account_status === 'active' ? 'default' : user.account_status === 'inactive' ? 'secondary' : 'destructive'}
                      >
                        {user.account_status}
                      </Badge>
                      <Badge variant="outline">{user.role}</Badge>
                      {user.is_protected_owner ? <Badge variant="secondary">owner</Badge> : null}
                      {user.admin_override_plan ? <Badge variant="outline">{adminOverridePlanLabel(user.admin_override_plan)}</Badge> : null}
                      <span className="text-[11px] text-muted-foreground">
                        Last seen: {formatLastSeen(user.last_active_at)} ({formatDate(user.last_active_at)})
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="hidden md:block rounded-lg border overflow-auto max-h-[500px]">
              <table className="w-full min-w-[740px] text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 text-left w-10">
                      <Checkbox
                        checked={selectableUserIds.length > 0 && selectedIds.size === selectableUserIds.length}
                        onCheckedChange={(value) => toggleSelectAllOnPage(Boolean(value))}
                        disabled={selectableUserIds.length === 0}
                        aria-label="Select all users on page"
                      />
                    </th>
                    <th className="p-2 text-left">User</th>
                    <th className="p-2 text-left">Presence</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Role</th>
                    <th className="p-2 text-left">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground">
                        No users found for current filters.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr
                        key={user.user_id}
                        className={`border-t cursor-pointer hover:bg-muted/30 ${selectedUserId === user.user_id ? 'bg-primary/5' : ''}`}
                        onClick={() => setSelectedUserId(user.user_id)}
                      >
                        <td className="p-2" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(user.user_id)}
                            onCheckedChange={(value) => toggleSelectUser(user.user_id, Boolean(value))}
                            disabled={Boolean(user.is_protected_owner)}
                            aria-label={`Select ${user.email || user.user_id}`}
                          />
                        </td>
                        <td className="p-2">
                          <div className="font-medium">{user.full_name || user.email || 'Unnamed User'}</div>
                          <div className="text-xs text-muted-foreground font-mono">{user.email || user.user_id}</div>
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={isOnlineNow(user.last_active_at) ? 'default' : 'secondary'}
                            className={isOnlineNow(user.last_active_at) ? 'bg-green-600 hover:bg-green-600' : ''}
                          >
                            {isOnlineNow(user.last_active_at) ? 'online' : 'offline'}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={user.account_status === 'active' ? 'default' : user.account_status === 'inactive' ? 'secondary' : 'destructive'}
                          >
                            {user.account_status}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <Badge variant="outline">{user.role}</Badge>
                          {user.is_protected_owner ? <Badge variant="secondary" className="ml-1">owner</Badge> : null}
                          {user.admin_override_plan ? <Badge variant="outline" className="ml-1">{adminOverridePlanLabel(user.admin_override_plan)}</Badge> : null}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          <div className="flex flex-col">
                            <span>{formatLastSeen(user.last_active_at)}</span>
                            <span>{formatDate(user.last_active_at)}</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                User Profile Management
              </CardTitle>
              <CardDescription>
                View and edit account status, role, permissions, and profile fields.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedUser ? (
                <div className="text-sm text-muted-foreground">Select a user to manage account settings.</div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>User ID</Label>
                    <Input value={selectedUser.user_id} readOnly className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label>Email</Label>
                    <Input value={selectedUser.email || ''} readOnly />
                  </div>
                  <div className="space-y-1">
                    <Label>Full Name</Label>
                    <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Avatar URL</Label>
                    <Input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://..." />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Status</Label>
                      <Select value={status} onValueChange={(value) => setStatus(value as AccountStatus)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="suspended" disabled={selectedUserIsProtectedOwner}>Suspended</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Role</Label>
                      <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              disabled={selectedUserIsProtectedOwner && option.value !== 'admin'}
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Permissions (comma separated)</Label>
                    <Textarea
                      value={permissionsText}
                      onChange={(event) => setPermissionsText(event.target.value)}
                      placeholder="documents:read, users:manage"
                      className="min-h-[72px]"
                    />
                  </div>
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                    <div className="mb-3 space-y-1">
                      <Label>Plan Assignment</Label>
                      <p className="text-xs text-muted-foreground">
                        Current plan: <span className="font-medium">{adminAssignablePlanLabel(selectedUserCurrentPlan)}</span>.
                        Changes apply immediately to application limits and do not modify Paystack or other billing-provider records.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Select value={adminOverridePlan} onValueChange={(value) => setAdminOverridePlan(value as AdminAssignablePlanKey)}>
                        <SelectTrigger aria-label="Target plan">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ADMIN_ASSIGNABLE_PLAN_KEYS.map((plan) => (
                            <SelectItem key={plan} value={plan}>
                              {adminAssignablePlanLabel(plan)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant={selectedPlanChangeType === 'downgrade' ? 'destructive' : 'outline'}
                        onClick={onRequestAdminPlanChange}
                        disabled={savingAdminOverride || isReadOnlyMode}
                      >
                        {savingAdminOverride ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        {selectedPlanChangeType === 'reassignment'
                          ? 'Refresh Plan'
                          : selectedPlanChangeType === 'downgrade'
                            ? 'Downgrade'
                            : 'Upgrade'}
                      </Button>
                    </div>
                    <div className="mt-2 rounded border bg-background/70 px-2 py-1.5 text-xs text-muted-foreground">
                      Effective time: immediately after save. Impact: {adminAssignablePlanLabel(adminOverridePlan)} limits apply to new usage;
                      existing documents, chats, and generated content are preserved.
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Button onClick={onSaveUser} disabled={savingUser || isReadOnlyMode}>
                      {savingUser ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Save
                    </Button>
                    <Button variant="outline" onClick={onResetPassword} disabled={resettingPassword || isReadOnlyMode}>
                      {resettingPassword ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />}
                      Reset Password
                    </Button>
                    <Button variant="destructive" onClick={onDeleteUser} disabled={deletingUser || isReadOnlyMode || selectedUserIsProtectedOwner}>
                      {deletingUser ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Create User
              </CardTitle>
              <CardDescription>Create accounts with default role, status, and permissions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={createEmail} onChange={(event) => setCreateEmail(event.target.value)} placeholder="name@example.com" />
              </div>
              <div className="space-y-1">
                <Label>Password (optional)</Label>
                <PasswordInput
                  value={createPassword}
                  onChange={(event) => setCreatePassword(event.target.value)}
                  placeholder="Auto-generated if empty"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1">
                <Label>Full Name</Label>
                <Input value={createFullName} onChange={(event) => setCreateFullName(event.target.value)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select value={createRole} onValueChange={(value) => setCreateRole(value as UserRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={createStatus} onValueChange={(value) => setCreateStatus(value as AccountStatus)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Permissions</Label>
                <Textarea
                  value={createPermissions}
                  onChange={(event) => setCreatePermissions(event.target.value)}
                  placeholder="documents:read, users:manage"
                  className="min-h-[72px]"
                />
              </div>
              <Button onClick={onCreateUser} className="w-full" disabled={creatingUser || isReadOnlyMode}>
                {creatingUser ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                Create User
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">User Activity Logs</CardTitle>
              <CardDescription>Recent activity for the selected user.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[280px] overflow-auto">
              {loadingActivity ? (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Loading activity...
                </div>
              ) : activityLogs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No activity logs for this user.</div>
              ) : (
                activityLogs.map((log) => (
                  <div key={log.id} className="rounded-md border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline">{log.kind}</Badge>
                      <span className="text-muted-foreground">{formatDate(log.created_at)}</span>
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog
        open={Boolean(pendingPlanChange)}
        onOpenChange={(open) => {
          if (!open && !savingAdminOverride) setPendingPlanChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm plan downgrade</AlertDialogTitle>
            <AlertDialogDescription>
              This changes the user from {adminAssignablePlanLabel(selectedUserCurrentPlan)} to{' '}
              {adminAssignablePlanLabel(pendingPlanChange?.targetPlan || 'free')}. The user may lose access to
              higher-tier features or limits for new activity, but existing documents, chats, and generated content
              will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingAdminOverride}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingAdminOverride || !pendingPlanChange}
              onClick={() => {
                const targetPlan = pendingPlanChange?.targetPlan;
                setPendingPlanChange(null);
                if (targetPlan) void applyAdminPlanChange(targetPlan);
              }}
            >
              {savingAdminOverride ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm downgrade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
