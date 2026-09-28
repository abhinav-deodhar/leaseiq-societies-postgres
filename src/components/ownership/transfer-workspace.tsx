'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {type Transfer,transferLabels} from '@/lib/contracts/owner-transfer';
import type {InboxApplication} from '@/lib/contracts/application-inbox';
import ApplicationAttachments from '@/components/resident/application-attachments';
import s from './transfer-workspace.module.css';
function date(v:string){return new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}
async function json(url:string,init?:RequestInit){const r=await fetch(url,{cache:'no-store',...init});const b=await r.json();if(!r.ok)throw new Error(b.message??'The request could not be completed.');return b;}
export default function TransferWorkspace({societyId,applicationId=''}:{societyId?:string;applicationId?:string}){
 const chairman=!!societyId;const endpoint=chairman?`/api/chairman/societies/${societyId}/owner-transfers`:'/api/resident/owner-transfers';
 const [data,setData]=useState<{items:Transfer[];hasMore:boolean}|null>(null);const [page,setPage]=useState(1);
 const [selected,setSelected]=useState('');const [attempt,setAttempt]=useState(0);const [error,setError]=useState('');const [message,setMessage]=useState('');
 const [candidate,setCandidate]=useState<InboxApplication|null>(null);const [startNote,setStartNote]=useState('');const [startAck,setStartAck]=useState(false);
 const [busy,setBusy]=useState(false);const [starting,setStarting]=useState(!!applicationId);const lock=useRef(false);
 useEffect(()=>{const c=new AbortController();json(`${endpoint}?page=${page}`,{signal:c.signal}).then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[endpoint,page,attempt]);
 useEffect(()=>{if(!societyId||!applicationId)return;const c=new AbortController();json(`/api/chairman/societies/${societyId}/resident-applications?application=${encodeURIComponent(applicationId)}`,{signal:c.signal}).then(b=>{const item=b.items?.[0];if(!item)throw new Error('Application not found.');setCandidate(item);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[societyId,applicationId]);
 async function send(body:Record<string,unknown>){if(lock.current)return false;lock.current=true;setBusy(true);setError('');setMessage('');
 try{const b=await json(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});setMessage(b.message);setAttempt(a=>a+1);return true;}
 catch(e){setError(e instanceof Error?e.message:'Result not confirmed. Refresh before trying again.');setAttempt(a=>a+1);return false;}finally{lock.current=false;setBusy(false);}}
 const current=data?.items.find(t=>t.id===selected)??data?.items[0];
 return <main className={s.shell}><header className={s.header}><div><p className={s.eyebrow}>{chairman?'Chairman workspace':'Your home records'}</p><h1>Ownership transfers</h1><p className={s.muted}>{chairman?'Review evidence, collect owner confirmations and complete the record update.':'Review requests involving your flat and track their progress.'}</p></div><div className={s.actions}>
 <Link className={s.secondary} href={chairman?'/chairman/resident-applications':'/resident'}>{chairman?'Resident applications':'Resident dashboard'}</Link>
 <button type="button" className={s.secondary} disabled={busy} onClick={()=>{setError('');setAttempt(a=>a+1);}}>Refresh</button></div></header>
 {error&&<p role="alert" className={`${s.notice} ${s.error}`}>{error}</p>}{message&&<p role="status" className={`${s.notice} ${s.success}`}>{message}</p>}
 {starting&&chairman&&<section className={s.card}><p className={s.eyebrow}>Start a transfer review</p><h2>Check the proposed change</h2>
 {!candidate?<p role="status">Loading application…</p>:<><dl className={s.facts}><div><dt>Flat</dt><dd>{candidate.wing} · {candidate.flatNumber}</dd></div><div><dt>Proposed new owner</dt><dd>{candidate.fullName}</dd></div><div><dt>Current owners</dt><dd>{candidate.currentOwners.map(o=>o.fullName).join(', ')||'None'}</dd></div><div><dt>Application</dt><dd>{candidate.status}</dd></div></dl>
 <ApplicationAttachments requestId={candidate.id} relationship="owner" chairman/>
 <p className={s.notice}>This is a full ownership-record transfer. Every listed current owner must confirm. Their owner access ends only after final approval. For partial transfers, co-ownership or unavailable owners, use a separately reviewed process; this flow cannot override confirmation.</p>
 <label className={s.label}>Review note for the owners<textarea className={s.field} rows={3} maxLength={1000} value={startNote} onChange={e=>setStartNote(e.target.value)} placeholder="Explain the proposed update and the evidence reviewed."/></label>
 <label className={s.check}><input type="checkbox" checked={startAck} onChange={e=>setStartAck(e.target.checked)}/>I have reviewed the ownership evidence and verified that all listed current owner records should be replaced by this applicant.</label>
 <div className={s.actions}><button type="button" className={s.primary} disabled={busy||!startAck||startNote.trim().length<10||candidate.status!=='pending'||!candidate.currentOwners.length||candidate.isOwn} onClick={async()=>{if(await send({action:'start',requestId:candidate.id,expectedRevision:candidate.revision,note:startNote}))setStarting(false);}}>Request owner confirmations</button><button type="button" className={s.secondary} onClick={()=>setStarting(false)}>Close</button></div></>}
 </section>}
 {!starting&&(!data?<p role="status">Loading ownership transfers…</p>:!data.items.length?<section className={s.card}><h2>No transfers on this page</h2><p className={s.muted}>{chairman?'Open a pending application for a flat that already has an owner, then choose “Review ownership transfer”.':'When a chairman requests your confirmation, it will appear here. Your current ownership access continues until the transfer is completed.'}</p></section>:<div className={s.layout}><aside aria-label="Transfer requests"><div className={s.queue}>{data.items.map(t=><button type="button" key={t.id} className={s.item} aria-pressed={t.id===current?.id} onClick={()=>setSelected(t.id)}><span className={s.badge} data-status={t.status}>{t.expired?'Expired · new review required':transferLabels[t.status]}</span><strong>{t.flat}</strong><span>{t.incomingName}</span><span className={s.muted}>{t.societyName}</span></button>)}</div></aside>
 {current&&<TransferDetail key={`${current.id}:${current.revision}`} transfer={current} chairman={chairman} busy={busy} send={send}/>}</div>)}
 {!starting&&data&&<nav aria-label="Transfer pages" className={s.pager}><button type="button" className={s.secondary} disabled={page===1||busy} onClick={()=>{setData(null);setPage(p=>p-1);}}>Previous</button><span>Page {page}</span><button type="button" className={s.secondary} disabled={!data.hasMore||busy} onClick={()=>{setData(null);setPage(p=>p+1);}}>Next</button></nav>}
 </main>;
}
function TransferDetail({transfer:t,chairman,busy,send}:{transfer:Transfer;chairman:boolean;busy:boolean;send:(b:Record<string,unknown>)=>Promise<boolean>}){
 const [note,setNote]=useState('');const [password,setPassword]=useState('');const [ack,setAck]=useState(false);
 const open=!['completed','cancelled'].includes(t.status);const canRespond=!chairman&&t.ownResponse!==null&&open&&!t.expired&&t.status!=='disputed';
 const canComplete=chairman&&t.status==='ready'&&!t.expired;
 async function act(action:string){try{await send({action,id:t.id,expectedRevision:t.revision,note,password:password||undefined,acknowledged:ack});}finally{setPassword('');}}
 return <article className={s.card}><span className={s.badge} data-status={t.status}>{t.expired?'Expired · new review required':transferLabels[t.status]}</span><h2 style={{marginTop:18}}>{t.flat}</h2><p className={s.muted}>{t.societyName}</p>
 <ol aria-label="Transfer progress" className={s.progress}><li data-done="true">1 · Evidence reviewed</li><li data-done={['ready','completed'].includes(t.status)}>2 · Owners confirm</li><li data-done={t.status==='completed'}>3 · Chairman final approval</li></ol>
 <dl className={s.facts}><div><dt>Proposed new owner</dt><dd>{t.incomingName}</dd></div><div><dt>Requested</dt><dd>{date(t.createdAt)}</dd></div><div><dt>Confirmation deadline</dt><dd>{date(t.expiresAt)}</dd></div><div><dt>Effective date</dt><dd>When the chairman completes approval</dd></div></dl>
 <h3>{t.status==='completed'?'Previous owners':'Current owners included in this request'}</h3><ul className={s.owners}>{t.owners.map((o,i)=><li key={i}><span>{o.name}</span><strong>{o.response==='confirmed'?'Confirmed':o.response==='disputed'?'Disputed':'Awaiting confirmation'}</strong></li>)}</ul>
 <h3>Chairman’s review note</h3><p className={s.muted} style={{whiteSpace:'pre-wrap'}}>{t.note}</p>
 {chairman&&<ApplicationAttachments requestId={t.requestId} relationship="owner" chairman/>}
 {open&&<p className={s.notice}>{t.status==='disputed'?'A current owner has raised a dispute. Approval is paused. Investigate before cancelling and beginning a fresh review.':t.expired?'The confirmation window has expired. No ownership changes have been made. The chairman must cancel and start a new review.':'This updates the society’s ownership records and owner access. It does not execute a property sale. Existing tenants, agreements and billing history are not changed by this action.'}</p>}
 {(canRespond||canComplete||chairman&&open)&&<fieldset disabled={busy}><label className={s.label}>Message · required for a dispute or cancellation<textarea className={s.field} rows={3} value={note} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label>
 {(canComplete||canRespond&&t.ownResponse==='pending')&&<><label className={s.check}><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{chairman?'I have reviewed the evidence and all owner confirmations. Complete this ownership-record update now.':`I confirm the proposed ownership-record update to ${t.incomingName}. I understand that my owner access for this flat will end when the chairman completes the transfer.`}</label><label className={s.label}>Confirm with your account password<input type="password" autoComplete="current-password" value={password} maxLength={128} onChange={e=>setPassword(e.target.value)} className={s.field}/></label></>}
 <div className={s.actions}>{canRespond&&t.ownResponse==='pending'&&<button type="button" className={s.primary} disabled={!ack||!password||busy} onClick={()=>void act('confirm')}>Confirm record update</button>}
 {canRespond&&<button type="button" className={s.secondary} disabled={note.trim().length<10||busy} onClick={()=>void act('dispute')}>Raise a dispute</button>}
 {canComplete&&<button type="button" className={s.primary} disabled={!ack||!password||busy} onClick={()=>void act('complete')}>Complete ownership transfer</button>}
 {chairman&&open&&<button type="button" className={s.secondary} disabled={note.trim().length<10||busy} onClick={()=>void act('cancel')}>Cancel transfer request</button>}</div></fieldset>}
 <h3 style={{marginTop:28}}>Activity</h3><ol className={s.history}>{t.history.map((e,i)=><li key={i}><strong>{e.action.charAt(0).toUpperCase()+e.action.slice(1)}</strong><p>{e.note}</p><span className={s.muted}>{date(e.at)}</span></li>)}</ol>
 <p className={s.muted} style={{fontSize:12,overflowWrap:'anywhere'}}>Transfer reference: {t.id}</p>
 </article>;
}
