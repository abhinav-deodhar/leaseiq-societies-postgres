import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomInt} from 'node:crypto';
import {createRequire} from 'node:module';
import {getDatabase} from '../src/lib/server/db';
import {hashPassword} from '../src/lib/server/auth/password';
import {changeTransfer,listTransfers} from '../src/lib/server/services/owner-transfer.service';
import {reviewOwnerApplication} from '../src/lib/server/services/owner-application-review.service';
import {loadResidentDashboard} from '../src/lib/server/services/resident-dashboard.service';
import {authoriseResidentDocumentRead} from '../src/lib/server/services/resident-document-access.service';
import {listAttachments,deleteAttachment} from '../src/lib/server/services/application-attachments.service';
const {loadEnvConfig}=createRequire(import.meta.url)('@next/env') as typeof import('@next/env');
test('ownership transfers preserve confirmations, isolation, history and atomic ownership',async t=>{
 assert.notEqual(process.env.NODE_ENV,'production');loadEnvConfig(process.cwd(),true);
 assert.notEqual(process.env.NODE_ENV,'production');assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.PGHOST??''));assert.equal(process.env.PGDATABASE,'leaseiq_societies_dev');
 const db=getDatabase();const society=randomUUID(),unit=randomUUID();
 const chair=randomUUID(),seller=randomUUID(),coOwner=randomUUID(),buyer=randomUUID(),stranger=randomUUID();
 const admin=randomUUID();
 const users=[chair,seller,coOwner,buyer,stranger,admin];const password='TransferTest-Only!927';const hash=await hashPassword(password);
 const source1=randomUUID(),source2=randomUUID(),requestId=randomUUID(),proof=randomUUID();let installed=false;
 const c=await db.connect();
 try{await c.query('BEGIN');
 for(const [i,id] of users.entries())await c.query(`INSERT INTO users(id,full_name,email,phone,date_of_birth,password_hash,status,email_verified_at,phone_verified_at)
 VALUES($1,$2,$3,$4,'1990-01-01',$5,'active',now(),now())`,[id,`Transfer Test ${i}`,`transfer-${id}@example.invalid`,`+919${randomInt(100000000,1000000000)}`,hash]);
 await c.query('INSERT INTO platform_admins(user_id) VALUES($1)',[admin]);
 await c.query(`INSERT INTO societies(id,name,address_line_1,city,state_or_union_territory,pin_code,wing_count,total_units,one_bhk_units,service_status,created_by)
 VALUES($1,'Transfer Test Society','10 Test Road','Pune','Maharashtra','411001',1,1,1,'inactive',$2)`,[society,chair]);
 await c.query(`INSERT INTO society_applications(society_id,applicant_user_id,status,submitted_at,reviewed_at,reviewed_by) VALUES($1,$2,'approved',now(),now(),$3)`,[society,chair,admin]);
 await c.query(`INSERT INTO society_memberships(society_id,user_id,role,status) VALUES($1,$2,'chairman','active')`,[society,chair]);
 await c.query(`INSERT INTO society_units(id,society_id,wing,flat_number,created_by) VALUES($1,$2,'Test','103',$3)`,[unit,society,chair]);
 for(const [request,user] of [[source1,seller],[source2,coOwner]]){
 await c.query(`INSERT INTO resident_unit_requests(id,society_id,unit_id,user_id,relationship,status,submitted_at,reviewed_at,reviewed_by)
 VALUES($1,$2,$3,$4,'owner','approved',now(),now(),$5)`,[request,society,unit,user,chair]);
 await c.query(`INSERT INTO resident_unit_memberships(society_id,unit_id,user_id,relationship,source_request_id,approved_by) VALUES($1,$2,$3,'owner',$4,$5)`,[society,unit,user,request,chair]);}
 await c.query(`INSERT INTO resident_unit_requests(id,society_id,unit_id,user_id,relationship,status,submitted_at,applicant_profile)
 VALUES($1,$2,$3,$4,'owner','pending',now(),$5::jsonb)`,[requestId,society,unit,buyer,JSON.stringify({firstName:'Transfer',lastName:'Buyer',residesInFlat:false,correspondenceSameAsFlat:false,correspondenceAddress:{line1:'10 Test Road',line2:'',city:'Pune',state:'Maharashtra',pinCode:'411001'},familyMembers:[]})]);
 await c.query('COMMIT');installed=true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();if(!installed)await db.end();}
 try{
 let id='';
 const start={action:'start',requestId,expectedRevision:1,note:'Ownership evidence has been reviewed for this transfer.'};
 const state=async()=>{const q=await listTransfers(chair,society);return q.items.find(x=>x.id===id)!;};
 await t.test('ordinary approval cannot replace existing owners; transfer requires evidence',async()=>{
 await assert.rejects(reviewOwnerApplication(chair,society,requestId,{decision:'approved',expectedRevision:1,reviewNote:'Approved.'}));
 await assert.rejects(changeTransfer(chair,society,start));
 await db.query(`INSERT INTO resident_documents(id,society_id,uploaded_by,kind,request_id,subject_user_id,original_filename,storage_bucket,storage_key,
 declared_content_type,declared_size_bytes,verified_content_type,verified_size_bytes,sha256,status,created_at,verified_at)
 VALUES($1,$2,$3,'ownership_proof',$4,$3,'evidence.pdf','test-only-bucket',($1::uuid)::text,'application/pdf',100,'application/pdf',100,$5,'ready',now(),now())`,[proof,society,buyer,requestId,'a'.repeat(64)]);
 const result=await changeTransfer(chair,society,start);id=result.id;
 assert.equal((await state()).owners.length,2);
 await assert.rejects(changeTransfer(chair,society,start));
 });
 await t.test('private inbox, documents and owner responses are scoped to the participants',async()=>{
 assert.equal((await listTransfers(stranger,null)).items.some(x=>x.id===id),false);
 assert.equal((await listTransfers(seller,null)).items.some(x=>x.id===id),true);
 assert.equal((await listAttachments(chair,requestId,true)).items.length,1);
 await assert.rejects(listAttachments(stranger,requestId,false));
 await assert.rejects(authoriseResidentDocumentRead(seller,proof));
 await authoriseResidentDocumentRead(chair,proof);
 await assert.rejects(deleteAttachment(buyer,requestId,proof));
 await assert.rejects(changeTransfer(stranger,null,{action:'confirm',id,expectedRevision:1,password,acknowledged:true,note:''}));
 });
 await t.test('one confirmation is insufficient; stale revisions do not overwrite another response',async()=>{
 await assert.rejects(changeTransfer(chair,society,{action:'complete',id,expectedRevision:1,password,acknowledged:true,note:''}));
 await changeTransfer(seller,null,{action:'confirm',id,expectedRevision:1,password,acknowledged:true,note:''});
 assert.equal((await state()).status,'awaiting_confirmation');
 await assert.rejects(changeTransfer(coOwner,null,{action:'confirm',id,expectedRevision:1,password,acknowledged:true,note:''}));
 await changeTransfer(coOwner,null,{action:'confirm',id,expectedRevision:2,password,acknowledged:true,note:''});
 assert.equal((await state()).status,'ready');
 });
 await t.test('application changes invalidate consent; cancellation preserves existing access',async()=>{
 await db.query(`UPDATE resident_unit_requests SET revision=revision+1 WHERE id=$1`,[requestId]);
 await assert.rejects(changeTransfer(chair,society,{action:'complete',id,expectedRevision:3,password,acknowledged:true,note:''}));
 await changeTransfer(chair,society,{action:'cancel',id,expectedRevision:3,note:'The application changed; a fresh review is required.'});
 assert.equal((await state()).status,'cancelled');
 assert.equal((await db.query(`SELECT id FROM resident_unit_memberships WHERE unit_id=$1 AND status='active'`,[unit])).rowCount,2);
 });
 await t.test('dispute pauses approval and cannot be overridden by chairman',async()=>{
 id=(await changeTransfer(chair,society,{...start,expectedRevision:2})).id;
 await changeTransfer(seller,null,{action:'dispute',id,expectedRevision:1,note:'The details of this transfer are incorrect.'});
 assert.equal((await state()).status,'disputed');
 await assert.rejects(changeTransfer(chair,society,{action:'complete',id,expectedRevision:2,password,acknowledged:true,note:''}));
 await changeTransfer(chair,society,{action:'cancel',id,expectedRevision:2,note:'Cancelled for investigation of the disputed records.'});
 });
 await t.test('concurrent final approvals complete once, ending old associations while retaining decisions',async()=>{
 id=(await changeTransfer(chair,society,{...start,expectedRevision:2})).id;
 await changeTransfer(seller,null,{action:'confirm',id,expectedRevision:1,password,acknowledged:true,note:''});
 await changeTransfer(coOwner,null,{action:'confirm',id,expectedRevision:2,password,acknowledged:true,note:''});
 const results=await Promise.allSettled([1,2].map(()=>changeTransfer(chair,society,{action:'complete',id,expectedRevision:3,password,acknowledged:true,note:'All confirmations and evidence checked.'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await state()).status,'completed');
 const active=await db.query<{user_id:string}>(`SELECT user_id FROM resident_unit_memberships WHERE unit_id=$1 AND status='active'`,[unit]);
 assert.deepEqual(active.rows.map(x=>x.user_id),[buyer]);
 assert.equal((await db.query(`SELECT id FROM resident_unit_requests WHERE id=ANY($1::uuid[]) AND status='approved'`,[[source1,source2,requestId]])).rowCount,3);
 assert.equal((await db.query(`SELECT id FROM owner_transfer_events WHERE transfer_id=$1 AND action='completed'`,[id])).rowCount,1);
 assert.equal((await loadResidentDashboard(seller)).homes.some(h=>h.unitId===unit),false);
 assert.equal((await loadResidentDashboard(buyer)).homes.some(h=>h.unitId===unit),true);
 });
 }finally{
 const cleanup=await db.connect();try{await cleanup.query('BEGIN');
 await cleanup.query(`DELETE FROM owner_transfer_events WHERE transfer_id IN(SELECT id FROM owner_transfers WHERE society_id=$1)`,[society]);
 await cleanup.query(`DELETE FROM owner_transfer_participants WHERE transfer_id IN(SELECT id FROM owner_transfers WHERE society_id=$1)`,[society]);
 await cleanup.query(`DELETE FROM owner_transfers WHERE society_id=$1`,[society]);
 for(const table of ['resident_document_events','resident_documents','resident_unit_request_events','resident_unit_memberships','resident_unit_requests','society_memberships','society_units','society_applications']) await cleanup.query(`DELETE FROM ${table} WHERE society_id=$1`,[society]);
 await cleanup.query('DELETE FROM societies WHERE id=$1',[society]);
 await cleanup.query('DELETE FROM owner_transfer_auth_attempts WHERE user_id=ANY($1::uuid[])',[users]);
 await cleanup.query('DELETE FROM resident_upload_attempts WHERE user_id=ANY($1::uuid[])',[users]);
 await cleanup.query('DELETE FROM platform_admins WHERE user_id=$1',[admin]);
 await cleanup.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await cleanup.query('COMMIT');
 }catch(e){await cleanup.query('ROLLBACK');throw e;}finally{cleanup.release();await db.end();}
 }
});
