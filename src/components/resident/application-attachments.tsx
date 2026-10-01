'use client';
import {useEffect,useRef,useState} from 'react';
type Attachment={id:string;kind:string;name:string;size:number};
const labels:Record<string,string>={identity:'Identity document',ownership_proof:'Ownership evidence',rental_agreement:'Rental agreement'};
export default function ApplicationAttachments({requestId,relationship,editable=false,chairman=false}:{requestId:string;relationship:'owner'|'tenant';editable?:boolean;chairman?:boolean}) {
 const [items,setItems]=useState<Attachment[]>([]);const [attempt,setAttempt]=useState(0);
 const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');const [message,setMessage]=useState('');
 const [kind,setKind]=useState('identity');const [file,setFile]=useState<File|null>(null);
 const input=useRef<HTMLInputElement>(null);const lock=useRef(false);
 const url=`/api/application-documents?requestId=${encodeURIComponent(requestId)}${chairman?'&portal=chairman':''}`;
 useEffect(()=>{const c=new AbortController();fetch(url,{cache:'no-store',signal:c.signal}).then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.message??'Attachments could not be loaded.');setItems(b.items);setLoading(false);}).catch(e=>{if(!c.signal.aborted){setError(e.message);setLoading(false);}});return()=>c.abort();},[url,attempt]);
 async function upload(){if(!file||lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
 try{if(file.size>10*1024*1024||file.size===0)throw new Error('Choose a file between 1 byte and 10 MB.');
 const body=new FormData();body.set('kind',kind);body.set('file',file);
 const r=await fetch(url,{method:'POST',body,signal:AbortSignal.timeout(90000)});const b=await r.json();if(!r.ok)throw new Error(b.message??'Upload failed.');
 setMessage(b.message);setFile(null);if(input.current)input.current.value='';setAttempt(a=>a+1);
 }catch(e){setError(e instanceof Error&&e.name==='TimeoutError'?'Upload result not confirmed. Refresh files before retrying.':e instanceof Error?e.message:'Upload not confirmed. Refresh before retrying.');}finally{lock.current=false;setBusy(false);}}
 async function remove(id:string){if(lock.current)return;if(!window.confirm('Remove this attachment from the application?'))return;
 lock.current=true;setBusy(true);setError('');try{const r=await fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id}),signal:AbortSignal.timeout(20000)});const b=await r.json();if(!r.ok)throw new Error(b.message);setMessage(b.message);setAttempt(a=>a+1);}catch(e){setError(e instanceof Error?e.message:'Removal not confirmed.');}finally{lock.current=false;setBusy(false);}}
 return <section aria-label="Application attachments" className="lq-section my-6">
 <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-slate-900">Supporting documents</h3>
 <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{relationship==='owner'?'Attach identity or ownership evidence for review. Ownership transfers require ownership evidence.':'Attach your identity document and rental agreement. The agreement is private to authorised tenancy participants and verified owners.'}</p></div>
 <button type="button" disabled={busy} className="min-h-11 px-3 font-semibold text-emerald-800" onClick={()=>{setError('');setLoading(true);setAttempt(a=>a+1);}}>Refresh files</button></div>
 {error&&<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
 {message&&<p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-emerald-900">{message}</p>}
 {loading?<p role="status" className="mt-4">Loading attachments…</p>:<ul className="mt-4 divide-y divide-slate-200">{items.map(d=><li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
 <div className="min-w-0"><p className="break-all font-medium">{d.name}</p><p className="text-sm text-slate-500">{labels[d.kind]} · {(d.size/1024/1024).toFixed(1)} MB · Checked</p></div>
 <div className="flex gap-4"><a className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline" href={`/api/application-documents/${d.id}${chairman?'?portal=chairman':''}`}>Download<span className="sr-only"> {d.name}</span></a>
 {editable&&<button type="button" disabled={busy} className="min-h-11 text-sm font-semibold text-red-800" onClick={()=>void remove(d.id)}>Remove<span className="sr-only"> {d.name}</span></button>}</div></li>)}</ul>}
 {!loading&&!items.length&&!error&&<p className="mt-4 text-sm text-slate-500">No documents attached yet.</p>}
 {editable&&<fieldset disabled={busy} className="mt-5 grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2"><legend className="px-1 text-sm font-semibold">Add an attachment</legend>
 <label className="text-sm font-medium">Document purpose<select value={kind} onChange={e=>setKind(e.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="identity">Identity document</option><option value={relationship==='owner'?'ownership_proof':'rental_agreement'}>{relationship==='owner'?'Ownership evidence':'Rental agreement'}</option></select></label>
 <label className="text-sm font-medium">Choose a file<input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>{setFile(e.target.files?.[0]??null);setMessage('');}} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2"/><span className="mt-1 block text-xs text-slate-500">PDF, JPG or PNG · up to 10 MB each · five attachments maximum</span></label>
 <p className="text-sm text-slate-600">Choose a document purpose and file, then upload. Files are checked before becoming available. Uploading does not submit your application.</p>
 <button type="button" onClick={()=>void upload()} disabled={!file||busy} className="lq-button lq-primary">{busy?'Uploading and checking file…':'Upload attachment'}</button></fieldset>}
 </section>;
}
