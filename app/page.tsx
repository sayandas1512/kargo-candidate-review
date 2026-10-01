import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard";
import { getDashboardMetrics } from "@/lib/dashboard-metrics";
import { scoreTextColor, STATUS_STYLES } from "@/lib/score-colors";
import { isHighConfidence } from "@/lib/scoring-math";

export const dynamic = "force-dynamic";

type Criterion = { criterion_key: string; score: number; evidence_quote: string };

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SentBadge({ draft }: { draft: { kind: string; status: string; sentTo: string | null } | null }) {
  if (!draft || draft.status !== "sent") return null;
  return (
    <span
      title={draft.sentTo ? `Sent to ${draft.sentTo}` : undefined}
      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
        draft.kind === "rejection" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
      }`}
    >
      {draft.kind === "rejection" ? "Rejection sent" : "Invite sent"}
    </span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const style =
    rank === 1
      ? "bg-amber-400 text-white"
      : rank === 2
        ? "bg-slate-300 text-slate-800"
        : rank === 3
          ? "bg-orange-300 text-orange-900"
          : "bg-gray-100 text-gray-500";
  return <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${style}`}>{rank}</span>;
}

// Dashboard rows only ever show the confidence verdict -- the specific flags behind it
// (e.g. "location not mumbai no relocation") are meaningless without the rationale and
// evidence quote that explain them, which only the candidate detail page has room for.
function ConfidencePill({ lowConfidence, weightedTotal }: { lowConfidence: boolean; weightedTotal: number }) {
  if (lowConfidence) {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Low confidence</span>;
  }
  if (isHighConfidence(weightedTotal, lowConfidence)) {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">High confidence</span>;
  }
  return null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role: rawRole } = await searchParams;
  const role: "PM" | "SPM" = rawRole === "SPM" ? "SPM" : "PM";
  const [data, metrics] = await Promise.all([getDashboardData(role), getDashboardMetrics()]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <div className="flex rounded-full border border-gray-200 bg-white p-1 shadow-sm">
          {(["PM", "SPM"] as const).map((r) => (
            <Link
              key={r}
              href={`/?role=${r}`}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                role === r
                  ? r === "PM"
                    ? "bg-indigo-600 text-white"
                    : "bg-violet-600 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {r}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric
          label="Reviewed"
          value={`${metrics.reviewed.opened} of ${metrics.reviewed.total}`}
          sub="Baseline was 19 of 60"
          accent="border-indigo-500"
        />
        <Metric label="Decisions logged" value={String(metrics.decisionsLogged)} accent="border-emerald-500" />
        <Metric label="Drafts awaiting review" value={String(metrics.draftsAwaitingReview)} accent="border-amber-500" />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Shortlist (top {data.shortlist.length || "N"})</h2>
        {data.shortlist.length === 0 && <p className="text-sm text-gray-500">No shortlisted candidates yet.</p>}
        {data.shortlist.length > 0 && (
          <div className="divide-y overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {data.shortlist.map((c, i) => {
              const criteria = c.criteria as Criterion[];
              const top = [...criteria].sort((a, b) => b.score - a.score)[0];
              const total = Number(c.weightedTotal);
              return (
                <Link
                  key={c.candidateId}
                  href={`/candidates/${c.candidateId}`}
                  className="flex flex-col gap-3 p-4 transition-colors hover:bg-indigo-50/40 sm:flex-row sm:items-center sm:gap-4"
                >
                  <RankBadge rank={i + 1} />
                  <div className={`w-14 shrink-0 text-xl font-bold ${scoreTextColor(total)}`}>{total.toFixed(1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900">{c.fullName || "Name pending confirmation"}</div>
                    {top && (
                      <div className="mb-1 truncate text-sm text-gray-600">
                        <span className="font-medium text-gray-800">{data.nameByKey.get(top.criterion_key) ?? top.criterion_key}</span>
                        {top.evidence_quote && <span className="text-gray-500"> &ldquo;{top.evidence_quote}&rdquo;</span>}
                      </div>
                    )}
                    <ConfidencePill lowConfidence={c.lowConfidence} weightedTotal={total} />
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusChip status={c.status} />
                    <SentBadge draft={c.latestDraft} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Below the line, awaiting your review</h2>
        {data.belowTheLine.length === 0 && <p className="text-sm text-gray-500">Nothing here.</p>}
        {data.belowTheLine.length > 0 && (
          <div className="divide-y overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {data.belowTheLine.map((c, i) => {
              const criteria = c.criteria as Criterion[];
              const top = [...criteria].sort((a, b) => b.score - a.score)[0];
              const total = Number(c.weightedTotal);
              return (
                <Link
                  key={c.candidateId}
                  href={`/candidates/${c.candidateId}`}
                  className="flex flex-col gap-3 p-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <RankBadge rank={data.shortlist.length + i + 1} />
                  <div className={`w-14 shrink-0 text-lg font-semibold ${scoreTextColor(total)}`}>{total.toFixed(1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900">{c.fullName || "Name pending confirmation"}</div>
                    {top && (
                      <div className="mb-1 truncate text-sm text-gray-600">
                        <span className="font-medium text-gray-800">{data.nameByKey.get(top.criterion_key) ?? top.criterion_key}</span>
                        {top.evidence_quote && <span className="text-gray-500"> &ldquo;{top.evidence_quote}&rdquo;</span>}
                      </div>
                    )}
                    <ConfidencePill lowConfidence={c.lowConfidence} weightedTotal={total} />
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`text-xs font-medium ${c.firstOpenedAt ? "text-emerald-600" : "text-gray-300"}`}>
                      {c.firstOpenedAt ? "Reviewed" : "Not opened"}
                    </span>
                    <SentBadge draft={c.latestDraft} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Needs manual review</h2>
        {data.needsReview.length === 0 && <p className="text-sm text-gray-500">Nothing needs review.</p>}
        {data.needsReview.length > 0 && (
          <div className="divide-y overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {data.needsReview.map((c) => (
              <Link
                key={c.candidateId}
                href={`/candidates/${c.candidateId}`}
                className="flex items-center justify-between p-4 transition-colors hover:bg-gray-50"
              >
                <span className="text-sm text-gray-700">{c.createdAt.toLocaleString()}</span>
                <StatusChip status={c.status} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className={`rounded-xl border-l-4 ${accent} border-y border-r border-gray-200 bg-white p-4 shadow-sm`}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
