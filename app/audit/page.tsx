import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

function eventColor(event: string): string {
  if (event.includes("failed") || event.includes("rejected") || event.includes("leak")) return "bg-rose-100 text-rose-800";
  if (event.includes("deleted")) return "bg-gray-200 text-gray-700";
  if (event.includes("sent") || event.includes("confirmed") || event.includes("uploaded") || event.includes("ok")) return "bg-emerald-100 text-emerald-800";
  return "bg-sky-100 text-sky-800";
}

export default async function AuditPage() {
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-semibold text-gray-900">Audit log</h1>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Candidate</th>
              <th className="px-3 py-2">Meta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 text-gray-500">{r.createdAt.toLocaleString()}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${eventColor(r.event)}`}>{r.event}</span>
                </td>
                <td className="px-3 py-2 text-gray-700">{r.actor}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-400">{r.candidateId ?? "None"}</td>
                <td className="max-w-md truncate px-3 py-2 font-mono text-xs text-gray-500" title={JSON.stringify(r.meta)}>
                  {JSON.stringify(r.meta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
