import { requirePageRole } from "@/lib/auth";
import CommerceClient from "./CommerceClient";

export default async function CommercePage() {
  const profile = await requirePageRole(["admin", "staff", "customer"]);
  return <CommerceClient role={profile.role} customerId={profile.customerId} />;
}
