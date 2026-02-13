
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { supabase } from '@/lib/supabase-client/client';
import { Loader2 } from 'lucide-react';

export default function AnalyticsDashboard() {
  const { user } = useSmartAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ activeUsers: 0, totalEvents: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAnalytics() {
        if (!user) return;
        
        // Only fetch if admin (For now, we assume RLS blocks non-admins or we check email)
        // Ideally, check role.
        
        const { data, error } = await supabase
            .from('au_events')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(100);

        if (!error && data) {
            setEvents(data);
            
            // Simple Client-side stats for demo
            const uniqueUsers = new Set(data.map(e => e.user_id)).size;
            setStats({
                activeUsers: uniqueUsers,
                totalEvents: data.length
            });
        }
        setLoading(false);
    }
    fetchAnalytics();
  }, [user]);

  if (loading) return <Loader2 className="animate-spin" />;

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeUsers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events (Sample)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalEvents}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {events.map((event) => (
                <div key={event.id} className="flex items-center justify-between border-b pb-2">
                    <div>
                        <p className="font-medium">{event.event_type}</p>
                        <p className="text-sm text-muted-foreground">{event.user_id}</p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                    </div>
                </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
