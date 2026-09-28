import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {z} from 'zod';
import {getDatabase} from '@/lib/server/db';
import {HttpError} from '@/lib/server/http';
import {createDocumentStorage} from '@/lib/server/storage/document-storage';
import {authoriseResidentDocumentRead} from './resident-document-access.service';
import {requireChairmanSetupAccess} from './society-access.service';
import {lockSocietyUnitManagement} from '@/lib/server/repositories/unit-capacity.repository';
const max=10*1024*1024;
const kindSchema=z.enum(['identity','ownership_proof','rental_agreement']);
const uuid=z.uuid();
async function editable(user:string,request:string) {
 if(!uuid.safeParse(request).success) throw new HttpError(400,'Invalid application.');
 const q=await getDatabase().query(`SELECT id,society_id,unit_id,relationship FROM resident_unit_requests
 WHERE id=$1 AND user_id=$2 AND status IN ('draft','changes_requested')`,[request,user]);
 if(!q.rows[0]) throw new HttpError(403,'Only your draft or returned application accepts attachments.');
 return q.rows[0] as {id:string;society_id:string;unit_id:string;relationship:string};
}
export async function boundedMultipart(request:Request) {
 const type=request.headers.get('content-type')??'';
 if(!type.startsWith('multipart/form-data;')||!request.body) throw new HttpError(415,'Choose a file to upload.');
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 try{while(true){const r=await reader.read();if(r.done)break;total+=r.value.length;
 if(total>max+65536){await reader.cancel();throw new HttpError(413,'Choose a file smaller than 10 MB.');}chunks.push(r.value);}}
 finally{reader.releaseLock();}
 try{return await new Response(new Uint8Array(Buffer.concat(chunks)).buffer,{headers:{'Content-Type':type}}).formData();}
 catch{throw new HttpError(400,'The upload could not be read. Choose the file again.');}
}
async function verifyFile(file:File) {
 if(file.size<1||file.size>max) throw new HttpError(400,'Files must be between 1 byte and 10 MB.');
 const bytes=Buffer.from(await file.arrayBuffer());
 const type=bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':
 bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
 bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
 const extension=file.name.split('.').pop()?.toLowerCase();
 if(!type||type!==file.type||!((type==='application/pdf'&&extension==='pdf')||(type==='image/png'&&extension==='png')||(type==='image/jpeg'&&['jpg','jpeg'].includes(extension??'')))) throw new HttpError(400,'Upload a PDF, JPG or PNG whose content matches its file type.');
 const dir=await mkdtemp(join(tmpdir(),'leaseiq-scan-'));
 try {
  const path=join(dir,'upload');await writeFile(path,bytes,{mode:0o600});
  try{await promisify(execFile)(process.env.DOCUMENT_CLAMSCAN_PATH||'clamscan',['--no-summary','--infected','--alert-encrypted=yes','--alert-exceeds-max=yes','--max-filesize=11M','--max-scansize=40M','--max-recursion=8',path],{timeout:45000,maxBuffer:8192});}
  catch(e){if(typeof e==='object'&&e&&'code' in e&&e.code===1) throw new HttpError(400,'This file did not pass the security check. Choose a different file.');
  throw new HttpError(503,'File scanning is unavailable. Your application is saved; try the upload later.');}
 }finally{await rm(dir,{recursive:true,force:true});}
 return {bytes,type,sha:createHash('sha256').update(bytes).digest('hex')};
}
export async function uploadAttachment(user:string,requestId:string,form:FormData) {
 const initial=await editable(user,requestId);
 const kind=kindSchema.safeParse(form.get('kind'));const file=form.get('file');
 if(!kind.success||!(file instanceof File)) throw new HttpError(400,'Choose the document purpose and a file.');
 if((kind.data==='ownership_proof'&&initial.relationship!=='owner')||(kind.data==='rental_agreement'&&initial.relationship!=='tenant')) throw new HttpError(400,'Choose the document type for your application.');
 const attempts=await getDatabase().query<{attempts:number}>(`INSERT INTO resident_upload_attempts(user_id) VALUES($1)
 ON CONFLICT(user_id) DO UPDATE SET
 attempts=CASE WHEN resident_upload_attempts.window_start<now()-interval '1 hour' THEN 1 ELSE resident_upload_attempts.attempts+1 END,
 window_start=CASE WHEN resident_upload_attempts.window_start<now()-interval '1 hour' THEN now() ELSE resident_upload_attempts.window_start END RETURNING attempts`,[user]);
 if(attempts.rows[0].attempts>30)throw new HttpError(429,'Upload limit reached. Try again in an hour.');
 const verified=await verifyFile(file);
 const id=randomUUID();const key=`resident-documents/${id}`;
 const storage=createDocumentStorage();let stored=false;let committing=false;let committed=false;
 const c=await getDatabase().connect();let discard=false;
 try {
  await storage.client.send(new PutObjectCommand({Bucket:storage.bucket,Key:key,Body:verified.bytes,ContentType:verified.type}),{abortSignal:AbortSignal.timeout(20000)});stored=true;
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='10s'");await lockSocietyUnitManagement(c,initial.society_id);
  const r=(await c.query<{relationship:string;tenancy_id:string|null;move_in_date:string|null;tenancy_end_date:string|null}>(`SELECT relationship,tenancy_id,move_in_date::text,tenancy_end_date::text
  FROM resident_unit_requests WHERE id=$1 AND user_id=$2 AND status IN ('draft','changes_requested') FOR UPDATE`,[requestId,user])).rows[0];
  if(!r||r.relationship!==initial.relationship) throw new HttpError(409,'Your application changed. Refresh before uploading.');
  const available=await c.query(`SELECT s.id FROM societies s JOIN society_applications a ON a.society_id=s.id
   JOIN users u ON u.id=$2 WHERE s.id=$1 AND s.service_status IN ('inactive','active') AND a.status='approved'
   AND u.status='active' AND u.email_verified_at IS NOT NULL AND (u.phone_verified_at IS NOT NULL OR u.verification_policy='email_only')
   AND NOT EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id) FOR SHARE OF s,a,u`,[initial.society_id,user]);
  if(!available.rowCount) throw new HttpError(403,'This application cannot accept uploads.');
  const counts=(await c.query<{total:number;active:number}>(`SELECT count(*)::int AS total,
   count(*) FILTER(WHERE status<>'deleted')::int AS active FROM resident_documents
   WHERE request_id=$1 OR (tenancy_id=$2 AND uploaded_by=$3)`,[requestId,r.tenancy_id,user])).rows[0];
  if(counts.total>=30||counts.active>=5) throw new HttpError(400,'This application accepts up to five attachments. Remove an unwanted attachment first.');
  let tenancy=r.tenancy_id;let version:number|null=null;
  if(kind.data==='rental_agreement') {
   if(!r.move_in_date) throw new HttpError(400,'Save the tenancy move-in date before uploading an agreement.');
   if(!tenancy){
    tenancy=(await c.query<{id:string}>(`INSERT INTO resident_tenancies(society_id,unit_id,created_by,starts_on,ends_on) VALUES($1,$2,$3,$4,$5) RETURNING id`,[initial.society_id,initial.unit_id,user,r.move_in_date,r.tenancy_end_date])).rows[0].id;
    await c.query(`UPDATE resident_unit_requests SET tenancy_id=$2 WHERE id=$1`,[requestId,tenancy]);
    await c.query(`INSERT INTO resident_tenancy_events(society_id,tenancy_id,actor_user_id,action) VALUES($1,$2,$3,'created')`,[initial.society_id,tenancy,user]);
   }
   const lease=await c.query(`SELECT id FROM resident_tenancies WHERE id=$1 AND society_id=$2 AND unit_id=$3 AND created_by=$4 AND status='draft' FOR UPDATE`,[tenancy,initial.society_id,initial.unit_id,user]);
   if(!lease.rowCount)throw new HttpError(409,'This tenancy cannot accept agreement changes.');
   version=(await c.query<{v:number}>(`SELECT COALESCE(max(agreement_version),0)+1 AS v FROM resident_documents WHERE tenancy_id=$1`,[tenancy])).rows[0].v;
  }
  const name=Array.from(file.name).map(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127||ch==='/'||ch==='\\'?'_':ch).join('').slice(0,255)||'document';
  await c.query(`INSERT INTO resident_documents(id,society_id,uploaded_by,kind,request_id,subject_user_id,tenancy_id,agreement_version,
   original_filename,storage_bucket,storage_key,declared_content_type,declared_size_bytes,verified_content_type,verified_size_bytes,sha256,status,created_at,verified_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12,$13,$14,'ready',now(),now())`,
   [id,initial.society_id,user,kind.data,kind.data==='rental_agreement'?null:requestId,kind.data==='rental_agreement'?null:user,
    kind.data==='rental_agreement'?tenancy:null,version,name,storage.bucket,key,verified.type,file.size,verified.sha]);
  await c.query(`INSERT INTO resident_document_events(society_id,document_id,actor_user_id,action,access_basis)
   VALUES($1,$2,$3,'upload_requested','self'),($1,$2,$3,'upload_verified','self')`,[initial.society_id,id,user]);
  if(kind.data==='rental_agreement')await c.query(`INSERT INTO resident_tenancy_events(society_id,tenancy_id,actor_user_id,action,details)
   VALUES($1,$2,$3,'agreement_uploaded',$4::jsonb)`,[initial.society_id,tenancy,user,JSON.stringify({documentId:id,version})]);
  committing=true;await c.query('COMMIT');committed=true;return {id,message:'Attachment uploaded and checked.'};
 }catch(e){try{await c.query('ROLLBACK');}catch{discard=true;}
 if(stored&&!committed&&!committing){try{await storage.client.send(new DeleteObjectCommand({Bucket:storage.bucket,Key:key}),{abortSignal:AbortSignal.timeout(10000)});}catch{console.error('Unreferenced private upload requires cleanup:',id);}}throw e;
 }finally{c.release(discard);storage.client.destroy();}
}
export async function listAttachments(user:string,requestId:string,chairman:boolean) {
 if(!uuid.safeParse(requestId).success)throw new HttpError(400,'Invalid application.');
 const c=await getDatabase().connect();let discard=false;
 try{await c.query('BEGIN');
 const r=(await c.query<{user_id:string;society_id:string;tenancy_id:string|null;relationship:string;owner_review_status:string;status:string}>(`SELECT user_id,society_id,tenancy_id,relationship,owner_review_status,status FROM resident_unit_requests WHERE id=$1`,[requestId])).rows[0];
 if(!r)throw new HttpError(404,'Application not found.');
 if(chairman){await requireChairmanSetupAccess(c,user,r.society_id);
 if(!['pending','approved'].includes(r.status)||(r.relationship==='tenant'&&r.owner_review_status!=='approved'))throw new HttpError(403,'Documents are not available for chairman review yet.');}
 else if(r.user_id!==user)throw new HttpError(404,'Application not found.');
 const q=await c.query(`SELECT id,kind,original_filename AS name,declared_size_bytes::integer AS size,status FROM resident_documents
 WHERE status='ready' AND ((request_id=$1 AND subject_user_id=$2) OR ($4=false AND tenancy_id=$3 AND uploaded_by=$2)) ORDER BY created_at,id`,[requestId,r.user_id,r.tenancy_id,chairman]);
 await c.query('COMMIT');return {items:q.rows};
 }catch(e){try{await c.query('ROLLBACK');}catch{discard=true;}throw e;}finally{c.release(discard);}
}
export async function deleteAttachment(user:string,requestId:string,id:string) {
 const initial=await editable(user,requestId);
 if(!uuid.safeParse(id).success)throw new HttpError(400,'Invalid document.');
 const c=await getDatabase().connect();let discard=false;
 try{await c.query('BEGIN');await lockSocietyUnitManagement(c,initial.society_id);
 const r=(await c.query<{tenancy_id:string|null}>(`SELECT tenancy_id FROM resident_unit_requests WHERE id=$1 AND user_id=$2 AND status IN ('draft','changes_requested') FOR UPDATE`,[requestId,user])).rows[0];
 if(!r)throw new HttpError(409,'The application changed.');
 const q=await c.query(`UPDATE resident_documents SET status='deleted',deleted_at=clock_timestamp()
 WHERE id=$1 AND uploaded_by=$2 AND status='ready' AND (request_id=$3 OR tenancy_id=$4) RETURNING id`,[id,user,requestId,r.tenancy_id]);
 if(!q.rowCount)throw new HttpError(404,'Document not found.');
 await c.query(`INSERT INTO resident_document_events(society_id,document_id,actor_user_id,action,access_basis) VALUES($1,$2,$3,'deleted','self')`,[initial.society_id,id,user]);
 await c.query('COMMIT');return {message:'Attachment removed from your application.'};
 }catch(e){try{await c.query('ROLLBACK');}catch{discard=true;}throw e;}finally{c.release(discard);}
}
export async function downloadAttachment(user:string,id:string) {
 const grant=await authoriseResidentDocumentRead(user,id);const storage=createDocumentStorage();
 try{
 const object=await storage.client.send(new GetObjectCommand({Bucket:grant.storageBucket,Key:grant.storageKey}),{abortSignal:AbortSignal.timeout(20000)});
 if(!object.Body)throw new HttpError(404,'File not found.');
 const bytes=await object.Body.transformToByteArray();
 return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(grant.originalFilename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
 }finally{storage.client.destroy();}
}
