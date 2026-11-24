'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, ShieldCheck, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';

type Status = 'active' | 'inactive' | 'suspended';
type User = {
  user_id: string; email: string | null; full_name: string | null; provider: string | null;
  created_at: string | null; last_sign_in_at: string | null; last_active_at: string | null;
  account_status: Status; tier: string | null; admin_override_plan?: string | null; is_protected_owner?: boolean;
};
type Report = { manufacturer?: string; model?: string; androidVersion?: string; appVersion?: string; sdk?: number; reportedAt?: string };
const PAGE_SIZE = 25;
function date(value?: string | null) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Not recorded';
}
async function request(input: string, init: RequestInit = {}) {
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error('Sign in again to continue.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer ' + token);
  if (init.body) headers.set('Content-Type','application/json');
  const response = await fetch(input,{ ...init,headers,credentials:'same-origin',cache:'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 403 ? 'Conex verification required. Reopen Conex.' : 'Request failed. Please retry.');
  return body;
}

export function ConexUserManagement() {
  const [input,setInput] = useState('');
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);
  const [version,setVersion] = useState(0);
  const [users,setUsers] = useState<User[]>([]);
  const [total,setTotal] = useState(0);
  const [filtered,setFiltered] = useState(0);
  const [selectedId,setSelectedId] = useState<string | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [readOnly,setReadOnly] = useState(true);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [report,setReport] = useState<{id:string; data:Report|null; error?:boolean}|null>(null);
  const [reportBusy,setReportBusy] = useState(false);
  const reportGeneration = useRef(0);
  const selected = users.find(u => u.user_id === selectedId);
  const refresh = useCallback(() => setVersion(v=>v+1),[]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({q:query,page:String(page),pageSize:String(PAGE_SIZE),sortBy:'created_at',sortDir:'desc'});
    void request('/api/admin/users?'+params.toString(),{signal:controller.signal}).then(data=>{
      if (!active) return;
      const rows:User[] = Array.isArray(data?.users)?data.users:[];
      setUsers(rows);setTotal(Number(data?.totalUsers)||0);setFiltered(Number(data?.filteredTotal)||0);
      setReadOnly(data?.source !== 'auth_admin');
      setSelectedId(id=>id && rows.some(row=>row.user_id===id)?id:null);
    }).catch(e=>{if(active){setUsers([]);setSelectedId(null);setError(e instanceof Error?e.message:'Could not load users.');}})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;controller.abort();};
  },[query,page,version]);
  useEffect(()=>{
    reportGeneration.current++;
    setReport(null);setReportBusy(false);setNotice('');
  },[selectedId]);
  async function loadDevice(id:string) {
    const generation = ++reportGeneration.current;
    setReportBusy(true);setReport(null);
    try {
      const data = await request('/api/admin/users?deviceReportFor='+encodeURIComponent(id));
      if(generation===reportGeneration.current)setReport({id,data:data?.report??null});
    } catch {if(generation===reportGeneration.current)setReport({id,data:null,error:true});}
    finally {if(generation===reportGeneration.current)setReportBusy(false);}
  }
  async function changeStatus(user:User,status:Status) {
    if(readOnly||busy||user.is_protected_owner||user.account_status===status)return;
    if(!window.confirm((status==='suspended'?'Suspend':'Change account status for')+' '+(user.email||user.user_id)+'?'))return;
    setBusy(true);setNotice('');
    try {
      await request('/api/admin/users',{method:'POST',body:JSON.stringify({action:'update_user',userId:user.user_id,status})});
      setNotice('Account status updated.');refresh();
    } catch(e){setNotice(e instanceof Error?e.message:'Could not update account.');}
    finally{setBusy(false);}
  }
  const pages = Math.max(1,Math.ceil(filtered/PAGE_SIZE));
  return <div className="space-y-4 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Users</h2><p className="text-sm text-muted-foreground">{total} registered accounts · {filtered} matching</p></div>
      <Button variant="outline" size="sm" disabled={loading||busy} onClick={refresh}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(input.trim().slice(0,120));}}>
      <Input className="min-w-0 flex-1" value={input} maxLength={120} onChange={e=>setInput(e.target.value)} placeholder="Search name, email or account ID" aria-label="Search users"/>
      <Button type="submit" variant="outline" disabled={loading||busy}><Search className="mr-2 h-4 w-4"/>Search</Button>
    </form>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading?<p className="text-sm text-muted-foreground">Loading users…</p>:
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm">
        <thead className="bg-muted"><tr>{['Account','Status','Recorded tier','Last activity'].map(t=><th key={t} className="p-3 text-left whitespace-nowrap">{t}</th>)}</tr></thead>
        <tbody>{users.length?users.map(user=><tr key={user.user_id} className={'border-t '+(selectedId===user.user_id?'bg-muted/60':'')}>
          <td className="p-3"><button type="button" className="text-left hover:underline max-w-[240px] break-all" disabled={busy} onClick={()=>setSelectedId(user.user_id)}>
            <span className="font-medium">{user.full_name||user.email||user.user_id}</span>
            {user.full_name&&user.email&&<span className="block text-xs text-muted-foreground">{user.email}</span>}
          </button></td><td className="p-3"><Badge variant="secondary">{user.account_status}</Badge>{user.is_protected_owner&&<span className="block text-xs">Owner</span>}</td>
          <td className="p-3">{user.admin_override_plan||user.tier||'Not recorded'}</td><td className="p-3 whitespace-nowrap">{date(user.last_active_at)}</td>
        </tr>):<tr><td colSpan={4} className="p-5 text-muted-foreground">No matching accounts.</td></tr>}</tbody>
      </table></div>}
    <div className="flex justify-between items-center gap-2">
      <Button variant="outline" size="sm" disabled={page<=1||loading||busy} onClick={()=>setPage(p=>p-1)}>Previous</Button>
      <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
      <Button variant="outline" size="sm" disabled={page>=pages||loading||busy} onClick={()=>setPage(p=>p+1)}>Next</Button>
    </div>
    {selected&&<Card><CardHeader><CardTitle className="break-words text-lg">{selected.full_name||selected.email||'Account details'}</CardTitle>
      <CardDescription>Account support and compatibility. Billing changes are not made here.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          {Object.entries({'Account ID':selected.user_id,'Email':selected.email,'Provider':selected.provider,'Recorded tier':selected.admin_override_plan||selected.tier,'Created':date(selected.created_at),'Last sign-in':date(selected.last_sign_in_at),'Last activity':date(selected.last_active_at)}).map(([label,value])=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-all">{value||'Not recorded'}</dd></div>)}
        </dl>
        {selected.is_protected_owner?<p className="flex gap-2 items-center text-sm"><ShieldCheck className="h-4 w-4"/>Protected owner account</p>:
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={readOnly||busy||selected.account_status==='active'} onClick={()=>void changeStatus(selected,'active')}>Activate</Button><Button variant="outline" disabled={readOnly||busy||selected.account_status==='suspended'} onClick={()=>void changeStatus(selected,'suspended')}>Suspend</Button></div>}
        {readOnly&&<p className="text-xs text-muted-foreground">Account changes unavailable in fallback mode.</p>}
        {notice&&<p role="status" className="text-sm">{notice}</p>}
        <div className="border-t pt-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium flex gap-2 items-center"><Smartphone className="h-4 w-4"/>Device compatibility</h3>
          <Button variant="outline" size="sm" disabled={reportBusy} onClick={()=>void loadDevice(selected.user_id)}>{reportBusy?'Loading…':'Load shared report'}</Button>
        </div><p className="text-xs text-muted-foreground">Optional user-shared device information, not a live or verified device identity.</p>
        {report?.id===selected.user_id&&(report.error?<p className="text-sm">Report unavailable.</p>:report.data?<dl className="grid gap-2 sm:grid-cols-2 text-sm">
          {Object.entries({Manufacturer:report.data.manufacturer,Model:report.data.model,Android:report.data.androidVersion,'Android API':report.data.sdk,'AU version':report.data.appVersion,Reported:date(report.data.reportedAt)}).map(([key,value])=><div key={key}><dt className="text-muted-foreground">{key}</dt><dd className="break-words">{value??'Not recorded'}</dd></div>)}
        </dl>:<p className="text-sm text-muted-foreground">No report shared.</p>)}
        </div>
      </CardContent></Card>}
  </div>;
}
