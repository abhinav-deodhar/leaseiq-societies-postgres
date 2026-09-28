import type {NextRequest} from 'next/server';
import {getSessionFromToken,readSessionToken} from '@/lib/server/auth/session';
import {checkRequestOrigin,HttpError,readJsonBody} from '@/lib/server/http';
import {jsonNoStore} from '@/lib/server/http/json';
import {applicationInboxFailure} from '@/lib/server/http/application-inbox';
import {boundedMultipart,uploadAttachment,listAttachments,deleteAttachment} from '@/lib/server/services/application-attachments.service';
export const runtime='nodejs';
async function auth(r:NextRequest,write=false){const portal=!write&&r.nextUrl.searchParams.get('portal')==='chairman'?'chairman':'resident';
 const s=await getSessionFromToken(readSessionToken(r,portal),portal);if(!s)throw new HttpError(401,'Sign in to continue.');return {s,portal};}
export async function GET(r:NextRequest){try{const {s,portal}=await auth(r);return jsonNoStore(await listAttachments(s.userId,r.nextUrl.searchParams.get('requestId')??'',portal==='chairman'));}catch(e){return applicationInboxFailure(e);}}
export async function POST(r:NextRequest){try{checkRequestOrigin(r);const {s}=await auth(r,true);return jsonNoStore(await uploadAttachment(s.userId,r.nextUrl.searchParams.get('requestId')??'',await boundedMultipart(r)));}catch(e){return applicationInboxFailure(e);}}
export async function DELETE(r:NextRequest){try{checkRequestOrigin(r);const {s}=await auth(r,true);const body=await readJsonBody(r,1024);
 if(typeof body!=='object'||body===null||!('id' in body)||typeof body.id!=='string')throw new HttpError(400,'Choose a document.');
 return jsonNoStore(await deleteAttachment(s.userId,r.nextUrl.searchParams.get('requestId')??'',body.id));}catch(e){return applicationInboxFailure(e);}}
