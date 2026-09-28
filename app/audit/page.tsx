import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-semibold">Audit log</h1>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
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
              <tr key={r.id} className="border-t align-top">
                <td className="whitespace-nowrap px-3 py-2 text-gray-500">{r.createdAt.toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.event}</td>
                <td className="px-3 py-2">{r.actor}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.candidateId ?? "—"}</td>
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
