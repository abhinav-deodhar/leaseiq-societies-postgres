import type {NextRequest} from 'next/server';
import {getSessionFromToken,readSessionToken} from '@/lib/server/auth/session';
import {HttpError} from '@/lib/server/http';
import {applicationInboxFailure} from '@/lib/server/http/application-inbox';
import {downloadAttachment} from '@/lib/server/services/application-attachments.service';
import {ResidentDocumentAccessError} from '@/lib/server/services/resident-document-access.service';
import {jsonNoStore} from '@/lib/server/http/json';
export const runtime='nodejs';
export async function GET(r:NextRequest,ctx:{params:Promise<{id:string}>}){try{
 const portal=r.nextUrl.searchParams.get('portal')==='chairman'?'chairman':'resident';
 const s=await getSessionFromToken(readSessionToken(r,portal),portal);if(!s)throw new HttpError(401,'Sign in to continue.');
 return await downloadAttachment(s.userId,(await ctx.params).id);
}catch(e){if(e instanceof ResidentDocumentAccessError)return jsonNoStore({message:e.message},e.status);return applicationInboxFailure(e);}}
