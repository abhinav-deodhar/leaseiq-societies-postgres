import type {NextRequest} from 'next/server';
import {getSessionFromToken,readSessionToken} from '@/lib/server/auth/session';
import {checkRequestOrigin,HttpError,readJsonBody} from '@/lib/server/http';
import {jsonNoStore} from '@/lib/server/http/json';
import {applicationInboxFailure} from '@/lib/server/http/application-inbox';
import {listTransfers,changeTransfer} from '@/lib/server/services/owner-transfer.service';
export const runtime='nodejs';
async function auth(r:NextRequest){const s=await getSessionFromToken(readSessionToken(r,'chairman'),'chairman');if(!s)throw new HttpError(401,'Sign in to continue.');return s;}
export async function GET(r:NextRequest,context:{params:Promise<{societyId:string}>}){try{const s=await auth(r);return jsonNoStore(await listTransfers(s.userId,(await context.params).societyId,Number(r.nextUrl.searchParams.get('page')??1)));}catch(e){return applicationInboxFailure(e);}}
export async function POST(r:NextRequest,context:{params:Promise<{societyId:string}>}){try{checkRequestOrigin(r);const s=await auth(r);return jsonNoStore(await changeTransfer(s.userId,(await context.params).societyId,await readJsonBody(r,8192)));}catch(e){return applicationInboxFailure(e);}}
