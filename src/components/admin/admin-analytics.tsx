'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Database, HardDrive, Activity } from 'lucide-react';
import { fetchAdmin } from '@/lib/api/admin-fetch';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { useNetworkStatus } from '@/components/providers/network-status-provider';

export const AdminAnalytics = ({ token }: { token: string }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isOnline } = useNetworkStatus();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isOnline) {
        setError('Offline');
        setData(null);
        return;
      }
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_analytics' })
      });

      if (!res.ok) {
        const payload = (res as any).data || (await res.json().catch(() => null));
        const msg = (payload && typeof payload === 'object' ? payload.error : null) || 'Failed to load analytics';
        throw new Error(msg);
      }
      
      const payload = (res as any).data || (await res.json().catch(() => null));
      const analytics = payload?.analytics || payload?.data?.analytics;
      if (!analytics) throw new Error('Analytics payload missing');
      setData(analytics);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Analytics fetch failed';
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>;
  if (!data) return <div className="p-6 text-sm text-muted-foreground">No analytics available.</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Database Analytics</h3>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-blue-100 rounded-lg text-blue-600"><HardDrive className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Storage Used</p>
              <p className="text-xl font-bold">{data.stats.totalStorage}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-purple-100 rounded-lg text-purple-600"><Database className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Rows</p>
              <p className="text-xl font-bold">{data.stats.totalRows}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-green-100 rounded-lg text-green-600"><Activity className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Active Connections</p>
              <p className="text-xl font-bold">{data.stats.activeConnections}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>API Traffic</CardTitle>
            <CardDescription>Daily API request volume.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.apiCalls}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Area type="monotone" dataKey="calls" stroke="#8884d8" fill="#8884d8" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage Growth</CardTitle>
            <CardDescription>Daily storage consumption (MB).</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.storage}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="size" fill="#82ca9d" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
