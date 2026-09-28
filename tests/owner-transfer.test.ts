import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertTransferReady,transferCommand} from '../src/lib/contracts/owner-transfer';
const ready={status:'ready',expired:false,requestMatches:true,ownersMatch:true,allConfirmed:true,evidenceMatches:true};
test('final approval requires every transfer invariant',()=>{
 assert.equal(assertTransferReady(ready),true);
 for(const key of ['requestMatches','ownersMatch','allConfirmed','evidenceMatches'] as const) assert.equal(assertTransferReady({...ready,[key]:false}),false,key);
 assert.equal(assertTransferReady({...ready,expired:true}),false);
 for(const status of ['awaiting_confirmation','disputed','cancelled','completed']) assert.equal(assertTransferReady({...ready,status}),false);
});
test('transfer input rejects unknown fields and invalid revisions',()=>{
 const start={action:'start',requestId:'a46646bc-934d-4bdf-8721-55060bb8fdd9',expectedRevision:1,note:'Reviewed the supporting evidence.'};
 assert.equal(transferCommand.safeParse(start).success,true);
 assert.equal(transferCommand.safeParse({...start,outgoingOwner:'someone'}).success,false);
 assert.equal(transferCommand.safeParse({...start,expectedRevision:0}).success,false);
});
