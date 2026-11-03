import { requirePageRole } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  await requirePageRole(["admin", "staff"]);
  return <DashboardClient />;
}
