import Link from "next/link";
import styles from "./workspace.module.css";
import OnboardingForm from "@/components/resident/onboarding-form";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getDatabase } from "@/lib/server/db";

export default async function ResidentOnboardingPage() {
  const session = await requirePortalSession("resident");
  const result = await getDatabase().query<{
    id: string;
    societyName: string;
    wing: string;
    flatNumber: string;
    relationship: string;
    status: string;
  }>(
    `SELECT r.id, s.name AS "societyName", u.wing,
            u.flat_number AS "flatNumber", r.relationship, r.status
     FROM resident_unit_requests r
     JOIN societies s ON s.id = r.society_id
     JOIN society_units u ON u.id = r.unit_id AND u.society_id = r.society_id
     WHERE r.user_id = $1
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 50`,
    [session.userId],
  );

  return (
    <main className={styles.workspace}>
      <header className={styles.topbar}>
        <Link href="/resident" className={styles.brand}>LeaseIQ</Link>
        <div className={styles.account}>{session.fullName} · Resident</div>
      </header>

      <div className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Resident registration</p>
          <h1 className={styles.title}>Connect to your home</h1>
          <p className={styles.subtitle}>
            Select your flat and complete your details. You can reopen a saved draft to continue.
          </p>
        </div>

        <div className={styles.layout}>
          <div className={styles.main}><OnboardingForm /></div>

          <aside className={styles.sidebar}>
            <section className={styles.sidePanel}>
              <h2>What you’ll complete</h2>
              <ol>
                <li><span>Select your society and flat</span></li>
                <li><span>Check your personal details</span></li>
                <li><span>Add family, if you live here as an owner</span></li>
                <li><span>Review and save your draft</span></li>
              </ol>
            </section>

            <section className={styles.sidePanel}>
              <h2>Your applications</h2>
              <Link href="/resident/applications"
                className="mt-2 inline-block text-sm font-semibold text-emerald-800 underline">
                Open applications and track status
              </Link>
              {!result.rows.length && <p>No saved applications yet.</p>}
              <ul className={styles.requests}>
                {result.rows.map((item) => <li key={item.id} className={styles.request}>
                  <h3>{item.societyName}</h3>
                  <p>{item.wing ? `Wing ${item.wing} · ` : ""}Flat {item.flatNumber}</p>
                  <span className={styles.status}>{item.relationship} · {item.status}</span>
                </li>)}
              </ul>
              <p className="mt-4">Select the same flat to reopen a draft. Saving does not grant access to flat services.</p>
            </section>

            <Link href="/resident" className="px-1 text-sm font-semibold text-emerald-800">
              ← Back to dashboard
            </Link>
          </aside>
        </div>
      </div>
    </main>
  );
}
