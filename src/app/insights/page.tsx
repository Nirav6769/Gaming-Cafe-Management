import { requirePageRole } from "@/lib/auth";
import InsightsClient from "@/components/analytics/InsightsClient";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const profile = await requirePageRole(["admin", "staff"]);
  return <InsightsClient role={profile.role} />;
}
