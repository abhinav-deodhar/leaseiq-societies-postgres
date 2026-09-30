"use client";
import {useRouter} from "next/navigation";
import {useState,useRef} from "react";
export default function DeleteDraft({societyId,requestId,revision,onDeleted}:{societyId:string;requestId:string;revision:number;onDeleted?:()=>void}) {
 const router=useRouter();
 const [busy,setBusy]=useState(false),[error,setError]=useState("");const lock=useRef(false);
 async function remove(){
  if(lock.current||!window.confirm("Delete this draft and remove access to its attachments? This cannot be undone."))return;
  lock.current=true;setBusy(true);setError("");
  try{const response=await fetch("/api/resident/applications",{method:"DELETE",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({societyId,requestId,expectedRevision:revision}),signal:AbortSignal.timeout(20000)});
   const body=await response.json();if(!response.ok)throw new Error(body.message??"Could not delete draft.");
   if(onDeleted) onDeleted(); else router.replace("/resident/applications");
   router.refresh();
  }catch(e){setError(e instanceof Error?e.message:"Deletion not confirmed. Refresh before retrying.");lock.current=false;setBusy(false);}
 }
 return <div className="mt-4"><button type="button" disabled={busy} onClick={()=>void remove()}
 className="min-h-11 rounded-lg border border-red-300 px-4 py-2 font-semibold text-red-800 disabled:opacity-50">{busy?"Deleting…":"Delete draft"}</button>
 {error&&<p role="alert" className="mt-2 text-red-800">{error}</p>}</div>;
}
