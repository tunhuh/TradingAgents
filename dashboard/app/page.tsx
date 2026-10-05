import { ReportsTable } from "@/components/reports-table";
import { listReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const reports = await listReports();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <ReportsTable reports={reports} />
    </div>
  );
}
