import {requirePageRole} from "@/lib/auth";
import OperationsClient from "@/components/operations/OperationsClient";
export default async function OperationsPage(){
 await requirePageRole(["admin","staff"]);
 return <OperationsClient/>;
}
