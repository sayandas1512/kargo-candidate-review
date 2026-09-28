import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

function StatusChip({ status }: { status: string }) {
  const color =
    status === "ready"
      ? "bg-green-100 text-green-800"
      : status === "scored"
        ? "bg-yellow-100 text-yellow-800"
        : "bg-gray-100 text-gray-800";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role: rawRole } = await searchParams;
  const role: "PM" | "SPM" = rawRole === "SPM" ? "SPM" : "PM";
  const data = await getDashboardData(role);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex rounded border">
          {(["PM", "SPM"] as const).map((r) => (
            <Link
              key={r}
              href={`/?role=${r}`}
              className={`px-4 py-1.5 text-sm ${role === r ? "bg-black text-white" : "text-gray-600"}`}
            >
              {r}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Reviewed" value={data.metrics.reviewedOf60} sub="baseline was 19 of 60" />
        <Metric
          label="Median review time"
          value={data.metrics.medianReviewMinutes !== null ? `${data.metrics.medianReviewMinutes}m` : "—"}
        />
        <Metric label="Decisions logged" value={String(data.metrics.decisionsLogged)} />
        <Metric label="Drafts awaiting review" value={String(data.metrics.draftsAwaitingReview)} />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Shortlist (top {data.shortlist.length || "N"})</h2>
        {data.shortlist.length === 0 && <p className="text-sm text-gray-500">No shortlisted candidates yet.</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.shortlist.map((c, i) => (
            <Link
              key={c.candidateId}
              href={`/candidates/${c.candidateId}`}
              className="rounded border bg-white p-4 shadow-sm hover:shadow"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm text-gray-400">#{i + 1}</span>
                <StatusChip status={c.status} />
              </div>
              <div className="mb-1 text-lg font-semibold">{Number(c.weightedTotal).toFixed(1)}</div>
              <div className="mb-2 text-sm text-gray-500">
                {(c.flags as string[]).length > 0 ? (c.flags as string[]).join(", ") : "no flags"}
                {c.lowConfidence && <span className="ml-1 text-amber-600">· low confidence</span>}
              </div>
              <TopEvidence criteria={c.criteria as { criterion_key: string; score: number; evidence_quote: string }[]} nameByKey={data.nameByKey} />
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Below the line, awaiting your review</h2>
        {data.belowTheLine.length === 0 && <p className="text-sm text-gray-500">Nothing here.</p>}
        <div className="overflow-hidden rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Rank</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Strongest criterion</th>
                <th className="px-3 py-2">Flags</th>
                <th className="px-3 py-2">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {data.belowTheLine.map((c, i) => {
                const criteria = c.criteria as { criterion_key: string; score: number; evidence_quote: string }[];
                const top = [...criteria].sort((a, b) => b.score - a.score)[0];
                return (
                  <tr key={c.candidateId} className="border-t">
                    <td className="px-3 py-2">
                      <Link href={`/candidates/${c.candidateId}`} className="text-blue-700 hover:underline">
                        #{data.shortlist.length + i + 1}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{Number(c.weightedTotal).toFixed(1)}</td>
                    <td className="px-3 py-2">
                      {top ? `${data.nameByKey.get(top.criterion_key) ?? top.criterion_key} — "${top.evidence_quote}"` : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{(c.flags as string[]).join(", ") || "—"}</td>
                    <td className="px-3 py-2">{c.firstOpenedAt ? "✓" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Needs manual review</h2>
        {data.needsReview.length === 0 && <p className="text-sm text-gray-500">Nothing needs review.</p>}
        <div className="overflow-hidden rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Uploaded</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.needsReview.map((c) => (
                <tr key={c.candidateId} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/candidates/${c.candidateId}`} className="text-blue-700 hover:underline">
                      {c.createdAt.toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function TopEvidence({
  criteria,
  nameByKey,
}: {
  criteria: { criterion_key: string; score: number; evidence_quote: string }[];
  nameByKey: Map<string, string>;
}) {
  const top2 = [...criteria].sort((a, b) => b.score - a.score).slice(0, 2);
  return (
    <ul className="space-y-1 text-xs text-gray-600">
      {top2.map((c) => (
        <li key={c.criterion_key}>
          <span className="font-medium">{nameByKey.get(c.criterion_key) ?? c.criterion_key}</span> ({c.score}/4)
          {c.evidence_quote && <> — &ldquo;{c.evidence_quote}&rdquo;</>}
        </li>
      ))}
    </ul>
  );
}
