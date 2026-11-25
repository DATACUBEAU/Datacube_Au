import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';
const Input = z.object({
  responseId:z.string().regex(/^[a-f0-9]{64}$/),
  section:z.enum(['android_gist','android_document']),
  rating:z.union([z.literal(1),z.literal(5),z.null()]),
  reason:z.enum(['clear','helpful','accurate','incorrect','irrelevant','unclear','incomplete']).nullable(),
}).strict();

export async function POST(req:NextRequest) {
  const reply=(body:object,status:number)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
  const auth=await requireUserFromRequest(req);
  if (!auth.ok || auth.source !== 'header') return reply({error:'unauthorized'},401);
  const raw=await req.text();
  if(raw.length>2048) return reply({error:'invalid_payload'},400);
  let input:unknown;
  try { input=JSON.parse(raw); } catch { return reply({error:'invalid_payload'},400); }
  const parsed=Input.safeParse(input);
  if(!parsed.success) return reply({error:'invalid_payload'},400);
  const {responseId,section,rating,reason}=parsed.data;
  if ((rating===null && reason!==null) ||
      (rating===5 && reason!==null && !['clear','helpful','accurate'].includes(reason)) ||
      (rating===1 && reason!==null && !['incorrect','irrelevant','unclear','incomplete'].includes(reason)))
      return reply({error:'invalid_reason'},400);
  const key=createHash('sha256').update('au-response-v1:'+auth.userId+':'+section+':'+responseId).digest('hex');
  try {
    const db=createSupabaseAdminClient();
    const {error}=rating===null
      ? await db.from('au_user_feedback').delete().eq('user_id',auth.userId).eq('idempotency_key',key)
      : await db.from('au_user_feedback').upsert({user_id:auth.userId,section,rating,comment:reason,
        metadata:{kind:'response_vote'},idempotency_key:key},{onConflict:'idempotency_key'});
    return error ? reply({error:'feedback_unavailable'},503) : reply({ok:true},200);
  } catch { return reply({error:'feedback_unavailable'},503); }
}
