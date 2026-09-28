import TransferWorkspace from '@/components/ownership/transfer-workspace';
import {requirePortalSession} from '@/lib/server/auth/require-portal-session';
import {getChairmanApplication} from '@/lib/server/services/chairman-application.service';
import Link from 'next/link';
export default async function Page({searchParams}:{searchParams:Promise<{application?:string}>}){
 const session=await requirePortalSession('chairman');const application=await getChairmanApplication(session.userId);
 if(!application||application.status!=='approved'||application.serviceStatus==='suspended')return <main className="p-8"><h1 className="text-2xl font-semibold">Ownership transfers</h1><p className="my-4">Your society must be approved and available.</p><Link href="/chairman/society">View society status</Link></main>;
 const query=await searchParams;return <TransferWorkspace societyId={application.societyId} applicationId={typeof query.application==='string'?query.application:''}/>;
}
