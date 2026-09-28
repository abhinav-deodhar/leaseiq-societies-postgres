import TransferWorkspace from '@/components/ownership/transfer-workspace';
import {requirePortalSession} from '@/lib/server/auth/require-portal-session';
export default async function Page(){await requirePortalSession('resident');return <TransferWorkspace/>;}
