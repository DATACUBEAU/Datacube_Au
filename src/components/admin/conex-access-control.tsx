'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';

type ConexUser = {
  user_id: string;
  tier: 'admin' | 'free';
  full_name: string | null;
  avatar_url: string | null;
  is_authorized: boolean;
  is_protected_owner?: boolean;
};

type ConexUsersResponse = {
  users: ConexUser[];
  authorizedUsers: ConexUser[];
};

function userInitials(fullName: string | null, userId: string): string {
  const source = (fullName || userId).trim();
  if (!source) return 'AU';
  const initials = source
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || 'AU';
}

export function ConexAccessControl() {
  const { toast } = useToast();
  const [users, setUsers] = useState<ConexUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const getAuthorizedHeaders = useCallback(async (base?: HeadersInit) => {
    const token = await getSupabaseAccessToken();
    if (!token) {
      throw new Error('Session expired. Please sign in again.');
    }
    const headers = new Headers(base ?? {});
    headers.set('Authorization', `Bearer ${token}`);
    return headers;
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const headers = await getAuthorizedHeaders({ Accept: 'application/json' });
      const res = await fetch('/conex/users', {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
      const payload = (await res.json().catch(() => null)) as ConexUsersResponse | { error?: string; message?: string } | null;

      if (!res.ok) {
        throw new Error((payload as any)?.message || (payload as any)?.error || 'Failed to load Conex users');
      }

      setUsers(Array.isArray((payload as ConexUsersResponse).users) ? (payload as ConexUsersResponse).users : []);
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[ConexAccessControl] loaded users', {
          count: Array.isArray((payload as ConexUsersResponse).users) ? (payload as ConexUsersResponse).users.length : 0,
        });
      }
    } catch (error: any) {
      const message = error?.message || 'Unable to load Conex access users.';
      setLoadError(message);
      toast({
        title: 'Access list error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [getAuthorizedHeaders, toast]);

  useEffect(() => {
    loadUsers().catch(() => {});
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) => {
      const name = String(user.full_name ?? '').toLowerCase();
      const id = user.user_id.toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [search, users]);

  const authorizedCount = users.filter((user) => user.is_authorized).length;

  const onToggle = useCallback(
    async (user: ConexUser, enabled: boolean) => {
      setSavingUserId(user.user_id);
      try {
        const headers = await getAuthorizedHeaders({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        });
        const res = await fetch('/conex/users', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            userId: user.user_id,
            tier: enabled ? 'admin' : 'free',
          }),
        });

        const payload = (await res.json().catch(() => null)) as
          | (ConexUsersResponse & { ok: true })
          | { error?: string; message?: string }
          | null;

        if (!res.ok) {
          throw new Error((payload as any)?.message || (payload as any)?.error || 'Failed to update user tier');
        }

        setUsers(Array.isArray((payload as ConexUsersResponse).users) ? (payload as ConexUsersResponse).users : []);
      } catch (error: any) {
        toast({
          title: 'Tier update failed',
          description: error?.message || 'Could not persist access change.',
          variant: 'destructive',
        });
      } finally {
        setSavingUserId(null);
      }
    },
    [getAuthorizedHeaders, toast]
  );

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Conex Access Control</CardTitle>
        <CardDescription>
          Grant or revoke Conex page access by switching each user tier between <code>admin</code> and <code>free</code>.
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Authorized: {authorizedCount}</Badge>
          <Button type="button" variant="outline" size="sm" onClick={() => loadUsers()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="conex-user-search">Search users</Label>
          <Input
            id="conex-user-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or user_id"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading Conex access users...
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <div>{loadError}</div>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => loadUsers().catch(() => {})}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground">No users found.</div>
        ) : (
          <div className="space-y-2">
            {filteredUsers.map((user) => {
              const isRootAdmin = Boolean(user.is_protected_owner);
              const toggleDisabled = isRootAdmin || savingUserId === user.user_id;

              return (
                <div key={user.user_id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={user.avatar_url || ''} alt={user.full_name || user.user_id} />
                      <AvatarFallback>{userInitials(user.full_name, user.user_id)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{user.full_name || 'Unnamed user'}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{user.user_id}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant={user.is_authorized ? 'default' : 'outline'}>
                      {user.is_authorized ? 'admin' : 'free'}
                    </Badge>
                    <Switch
                      checked={user.is_authorized}
                      onCheckedChange={(enabled) => onToggle(user, enabled)}
                      disabled={toggleDisabled}
                      aria-label={`Toggle Conex admin access for ${user.full_name || user.user_id}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
