import { z } from 'zod';
export const transferCommand = z.discriminatedUnion('action', [
 z.strictObject({action:z.literal('start'),requestId:z.uuid(),expectedRevision:z.number().int().positive(),note:z.string().trim().min(10).max(1000)}),
 z.strictObject({action:z.enum(['confirm','dispute','complete','cancel']),id:z.uuid(),expectedRevision:z.number().int().positive(),note:z.string().trim().max(1000),password:z.string().max(128).optional(),acknowledged:z.boolean().optional()}),
]);
export type Transfer = {
 id:string; societyId:string; societyName:string; unitId:string; flat:string;
 requestId:string; incomingName:string; status:string; revision:number;
 createdAt:string; expiresAt:string; expired:boolean; note:string;
 isIncoming:boolean; ownResponse:string|null;
 owners:{name:string;response:string}[];
 history:{action:string;at:string;note:string}[];
};
export const transferLabels:Record<string,string> = {
 awaiting_confirmation:'Awaiting owner confirmation',ready:'Ready for final review',
 disputed:'Disputed · review paused',completed:'Transfer completed',cancelled:'Cancelled',
};
export function assertTransferReady(input:{status:string;expired:boolean;requestMatches:boolean;ownersMatch:boolean;allConfirmed:boolean;evidenceMatches:boolean}) {
 return input.status==='ready' && !input.expired && input.requestMatches && input.ownersMatch && input.allConfirmed && input.evidenceMatches;
}
