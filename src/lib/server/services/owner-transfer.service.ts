import 'server-only';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {getDatabase} from '@/lib/server/db';
import {HttpError} from '@/lib/server/http';
import {verifyPassword} from '@/lib/server/auth/password';
import {requireChairmanSetupAccess} from './society-access.service';
import {lockSocietyUnitManagement} from '@/lib/server/repositories/unit-capacity.repository';
import {assertTransferReady,transferCommand,type Transfer} from '@/lib/contracts/owner-transfer';

const eligible = `status='active' AND email_verified_at IS NOT NULL
 AND (phone_verified_at IS NOT NULL OR verification_policy='email_only')
 AND NOT EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id=users.id)`;
async function account(client:PoolClient,id:string) {
 const q=await client.query(`SELECT id FROM users WHERE id=$1 AND ${eligible} FOR SHARE`,[id]);
 if(!q.rowCount) throw new HttpError(403,'This account is not eligible.');
}
async function stepUp(userId:string,password:string|undefined) {
 if(!password) throw new HttpError(400,'Enter your password to confirm this action.');
 const db=getDatabase();
 const q=await db.query<{attempts:number}>(`INSERT INTO owner_transfer_auth_attempts(user_id) VALUES($1)
 ON CONFLICT(user_id) DO UPDATE SET
 attempts=CASE WHEN owner_transfer_auth_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE owner_transfer_auth_attempts.attempts+1 END,
 window_start=CASE WHEN owner_transfer_auth_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE owner_transfer_auth_attempts.window_start END RETURNING attempts`,[userId]);
 if(q.rows[0].attempts>5) throw new HttpError(429,'Too many confirmation attempts. Try again in 15 minutes.');
 const u=await db.query<{password_hash:string|null}>(`SELECT password_hash FROM users WHERE id=$1 AND ${eligible}`,[userId]);
 if(!u.rows[0]?.password_hash || !await verifyPassword(password,u.rows[0].password_hash)) throw new HttpError(403,'Your password could not be verified.');
}
async function transaction<T>(userId:string,societyId:string,chairman:boolean,run:(c:PoolClient)=>Promise<T>) {
 if(!z.uuid().safeParse(societyId).success) throw new HttpError(400,'Invalid society.');
 const c=await getDatabase().connect(); let discard=false;
 try {
  await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='10s'"); await lockSocietyUnitManagement(c,societyId);
  await account(c,userId);
  if(chairman) await requireChairmanSetupAccess(c,userId,societyId);
  else {
   const s=await c.query(`SELECT s.id FROM societies s JOIN society_applications a ON a.society_id=s.id
    WHERE s.id=$1 AND s.service_status IN ('inactive','active') AND a.status='approved' FOR SHARE OF s,a`,[societyId]);
   if(!s.rowCount) throw new HttpError(403,'This society is not available.');
  }
  const result=await run(c); await c.query('COMMIT'); return result;
 } catch(e) {try{await c.query('ROLLBACK');}catch{discard=true;} throw e;} finally{c.release(discard);}
}
async function owners(c:PoolClient,society:string,unit:string) {
 return (await c.query<{id:string;user_id:string;source_request_id:string}>(`SELECT id,user_id,source_request_id
 FROM resident_unit_memberships WHERE society_id=$1 AND unit_id=$2 AND relationship='owner' AND status='active' ORDER BY id FOR UPDATE`,[society,unit])).rows;
}
async function event(c:PoolClient,id:string,user:string,action:string,note:string) {
 await c.query(`INSERT INTO owner_transfer_events(transfer_id,actor_user_id,action,note) VALUES($1,$2,$3,$4)`,[id,user,action,note]);
}
export async function listTransfers(userId:string,societyId:string|null,page=1) {
 if(!Number.isInteger(page)||page<1||page>100000) throw new HttpError(400,'Invalid page.');
 const run=async(c:PoolClient)=>{
 const q=await c.query<Transfer>(`SELECT t.id,t.society_id AS "societyId",s.name AS "societyName",t.unit_id AS "unitId",
 concat_ws(' · ',NULLIF(u.wing,''),NULLIF(u.floor_label,''),'Flat '||u.flat_number) AS flat,
 t.request_id AS "requestId",a.full_name AS "incomingName",t.status,t.revision,t.note,
 t.created_at AS "createdAt",t.expires_at AS "expiresAt",
 (t.expires_at<=now() AND t.status IN ('awaiting_confirmation','ready')) AS expired,
 t.incoming_user_id=$1 AS "isIncoming",
 (SELECT p.response FROM owner_transfer_participants p WHERE p.transfer_id=t.id AND p.user_id=$1) AS "ownResponse",
 (SELECT jsonb_agg(jsonb_build_object('name',o.full_name,'response',p.response) ORDER BY o.full_name)
  FROM owner_transfer_participants p JOIN users o ON o.id=p.user_id WHERE p.transfer_id=t.id) AS owners,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('action',e.action,'at',e.created_at,'note',e.note) ORDER BY e.created_at)
 FROM owner_transfer_events e WHERE e.transfer_id=t.id),'[]'::jsonb) AS history
 FROM owner_transfers t JOIN societies s ON s.id=t.society_id
 JOIN society_units u ON u.id=t.unit_id AND u.society_id=t.society_id JOIN users a ON a.id=t.incoming_user_id
 WHERE ($2::uuid IS NOT NULL AND t.society_id=$2) OR ($2::uuid IS NULL AND
 (t.incoming_user_id=$1 OR EXISTS(SELECT 1 FROM owner_transfer_participants p WHERE p.transfer_id=t.id AND p.user_id=$1)))
 ORDER BY CASE WHEN t.status IN ('completed','cancelled') THEN 1 ELSE 0 END,t.created_at DESC,t.id DESC LIMIT 21 OFFSET $3`,[userId,societyId,(page-1)*20]);
 return {items:q.rows.slice(0,20),hasMore:q.rows.length>20,page};};
 if(societyId) return transaction(userId,societyId,true,run);
 const c=await getDatabase().connect();try{return await run(c);}finally{c.release();}
}
export async function changeTransfer(userId:string,societyId:string|null,input:unknown) {
 const parsed=transferCommand.safeParse(input);
 if(!parsed.success) throw new HttpError(400,parsed.error.issues[0]?.message??'Check your input.');
 const x=parsed.data;
 if(!societyId && (x.action==='start'||x.action==='complete'||x.action==='cancel')) throw new HttpError(403,'A chairman must perform this action.');
 if(societyId && (x.action==='confirm'||x.action==='dispute')) throw new HttpError(403,'Use your resident account for an owner response.');
 if(x.action==='confirm'||x.action==='complete') {
  if(!x.acknowledged) throw new HttpError(400,'Read and confirm the ownership-record update.');
  await stepUp(userId,x.password);
 }
 if(!societyId && 'id' in x) {
  const found=await getDatabase().query<{society_id:string}>(`SELECT t.society_id FROM owner_transfers t
  JOIN owner_transfer_participants p ON p.transfer_id=t.id WHERE t.id=$1 AND p.user_id=$2`,[x.id,userId]);
  if(!found.rows[0]) throw new HttpError(404,'Transfer not found.');
  societyId=found.rows[0].society_id;
 }
 const society=societyId!;
 return transaction(userId,society,x.action==='start'||x.action==='complete'||x.action==='cancel',async c=>{
 if(x.action==='start') {
  const r=(await c.query<{id:string;unit_id:string;user_id:string;revision:number;status:string}>(`SELECT id,unit_id,user_id,revision,status
  FROM resident_unit_requests WHERE id=$1 AND society_id=$2 AND relationship='owner' FOR UPDATE`,[x.requestId,society])).rows[0];
  if(!r||r.status!=='pending'||r.revision!==x.expectedRevision) throw new HttpError(409,'Refresh the pending owner application first.');
  const old=await owners(c,society,r.unit_id);
  if(!old.length) throw new HttpError(409,'This flat has no active owner. Use ordinary application review.');
  if(r.user_id===userId||old.some(o=>o.user_id===userId)) throw new HttpError(403,'An independent chairman must review this transfer.');
  if(old.some(o=>o.user_id===r.user_id)) throw new HttpError(409,'The applicant is already a registered owner.');
  await account(c,r.user_id);
  const d=(await c.query<{id:string;sha256:string}>(`SELECT id,sha256 FROM resident_documents
  WHERE request_id=$1 AND subject_user_id=$2 AND society_id=$3 AND kind='ownership_proof' AND status='ready'
  ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE`,[r.id,r.user_id,society])).rows[0];
  if(!d) throw new HttpError(400,'Ownership evidence is required. Request application changes so the buyer can attach it.');
  const q=await c.query<{id:string}>(`INSERT INTO owner_transfers(society_id,unit_id,request_id,request_revision,incoming_user_id,created_by,evidence_id,evidence_sha256,note)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[society,r.unit_id,r.id,r.revision,r.user_id,userId,d.id,d.sha256,x.note]);
  for(const o of old) await c.query(`INSERT INTO owner_transfer_participants(transfer_id,membership_id,user_id) VALUES($1,$2,$3)`,[q.rows[0].id,o.id,o.user_id]);
  await event(c,q.rows[0].id,userId,'requested',x.note);
  return {id:q.rows[0].id,message:'Confirmation requested from all current owners. Their requests are available in the resident portal.'};
 }
 const t=(await c.query<{id:string;unit_id:string;incoming_user_id:string;request_id:string;request_revision:number;status:string;revision:number;expired:boolean;evidence_id:string;evidence_sha256:string}>(`SELECT *,expires_at<=clock_timestamp() AS expired FROM owner_transfers
 WHERE id=$1 AND society_id=$2 FOR UPDATE`,[x.id,society])).rows[0];
 if(!t) throw new HttpError(404,'Transfer not found.');
 const participants=(await c.query<{user_id:string;membership_id:string;response:string}>(`SELECT user_id,membership_id,response FROM owner_transfer_participants WHERE transfer_id=$1 ORDER BY membership_id FOR UPDATE`,[t.id])).rows;
 if((x.action==='complete'||x.action==='cancel')&&(t.incoming_user_id===userId||participants.some(p=>p.user_id===userId))) throw new HttpError(403,'An independent chairman must review this transfer.');
 if(t.revision!==x.expectedRevision) throw new HttpError(409,'This transfer changed. Refresh before continuing.');
 if(['completed','cancelled'].includes(t.status)) throw new HttpError(409,'This transfer is already closed.');
 if(x.action==='cancel') {
  if(x.note.length<10) throw new HttpError(400,'Explain why the transfer is cancelled.');
  await c.query(`UPDATE owner_transfers SET status='cancelled',revision=revision+1 WHERE id=$1`,[t.id]);
 } else {
  if(t.expired||t.status==='disputed') throw new HttpError(409,'This transfer is expired or disputed. The chairman must investigate and cancel before starting a fresh review.');
  const current=await owners(c,society,t.unit_id);
  const ownersMatch=current.map(o=>o.id).join(',')===participants.map(p=>p.membership_id).join(',');
  const r=(await c.query<{status:string;revision:number;user_id:string;unit_id:string}>(`SELECT status,revision,user_id,unit_id FROM resident_unit_requests WHERE id=$1 AND society_id=$2 FOR UPDATE`,[t.request_id,society])).rows[0];
  const requestMatches=!!r&&r.status==='pending'&&r.revision===t.request_revision&&r.user_id===t.incoming_user_id&&r.unit_id===t.unit_id;
  const d=await c.query(`SELECT id FROM resident_documents WHERE id=$1 AND sha256=$2 AND status='ready' AND kind='ownership_proof'
  AND request_id=$3 AND subject_user_id=$4 AND society_id=$5 FOR SHARE`,[t.evidence_id,t.evidence_sha256,t.request_id,t.incoming_user_id,society]);
  if(!ownersMatch||!requestMatches||!d.rowCount) throw new HttpError(409,'The owner records, application or evidence changed. Cancel and start a fresh transfer review.');
  if(x.action==='confirm'||x.action==='dispute') {
   const p=participants.find(p=>p.user_id===userId);
   if(!p) throw new HttpError(403,'Only the outgoing owner can respond.');
   if(x.action==='confirm'&&p.response!=='pending') throw new HttpError(409,'Your response is already recorded.');
   if(x.action==='dispute'&&x.note.length<10) throw new HttpError(400,'Explain the issue so the chairman can investigate.');
   await c.query(`UPDATE owner_transfer_participants SET response=$3,responded_at=clock_timestamp(),note=$4 WHERE transfer_id=$1 AND user_id=$2`,[t.id,userId,x.action==='confirm'?'confirmed':'disputed',x.note]);
   await c.query(`UPDATE owner_transfers SET status=CASE WHEN $2='dispute' THEN 'disputed'
   WHEN NOT EXISTS(SELECT 1 FROM owner_transfer_participants WHERE transfer_id=$1 AND response<>'confirmed') THEN 'ready'
   ELSE 'awaiting_confirmation' END,revision=revision+1 WHERE id=$1`,[t.id,x.action]);
  } else if(x.action==='complete') {
   if(!assertTransferReady({status:t.status,expired:t.expired,ownersMatch,requestMatches,evidenceMatches:!!d.rowCount,allConfirmed:participants.every(p=>p.response==='confirmed')})) throw new HttpError(409,'Every outgoing owner must confirm before final approval.');
   await account(c,t.incoming_user_id);
   const existing=await c.query(`SELECT id FROM resident_unit_memberships WHERE user_id=$1 AND unit_id=$2 AND status='active'`,[t.incoming_user_id,t.unit_id]);
   if(existing.rowCount) throw new HttpError(409,'The buyer already has an active association with this flat. Resolve it before transferring.');
   await c.query(`UPDATE resident_unit_memberships SET status='revoked',revoked_at=clock_timestamp(),revoked_by=$2,
    revocation_reason=$3 WHERE id=ANY($1::uuid[])`,[participants.map(p=>p.membership_id),userId,`Ownership-record transfer ${t.id}`]);
   const updated=await c.query<{revision:number}>(`UPDATE resident_unit_requests SET status='approved',reviewed_at=clock_timestamp(),reviewed_by=$2,
    review_note=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision`,[t.request_id,userId,`Ownership-record transfer ${t.id}`]);
   await c.query(`INSERT INTO resident_unit_memberships(society_id,unit_id,user_id,relationship,source_request_id,status,approved_by,move_in_date)
    SELECT society_id,unit_id,user_id,'owner',id,'active',$2,move_in_date FROM resident_unit_requests WHERE id=$1`,[t.request_id,userId]);
   await c.query(`INSERT INTO resident_unit_request_events(society_id,request_id,actor_user_id,action,request_revision,details)
    VALUES($1,$2,$3,'approved',$4,$5::jsonb)`,[society,t.request_id,userId,updated.rows[0].revision,JSON.stringify({transferId:t.id,reviewNote:'Ownership-record transfer completed'})]);
   for(const o of current) await c.query(`INSERT INTO resident_unit_request_events(society_id,request_id,actor_user_id,action,request_revision,details)
    SELECT society_id,id,$2,'membership_revoked',revision,$3::jsonb FROM resident_unit_requests WHERE id=$1`,[o.source_request_id,userId,JSON.stringify({transferId:t.id,reviewNote:'Owner association ended following confirmed transfer'})]);
   await c.query(`UPDATE owner_transfers SET status='completed',revision=revision+1,completed_at=clock_timestamp(),completed_by=$2 WHERE id=$1`,[t.id,userId]);
  }
 }
 await event(c,t.id,userId,x.action==='confirm'?'confirmed':x.action==='dispute'?'disputed':x.action==='complete'?'completed':'cancelled',x.note||'Ownership-record update confirmed.');
 return {id:t.id,message:x.action==='complete'?'Transfer completed. Previous ownership records remain in history.':'Your response has been recorded.'};
 });
}
