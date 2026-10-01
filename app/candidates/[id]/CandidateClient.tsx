"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { scoreTextColor, scoreBarColor, STATUS_STYLES } from "@/lib/score-colors";

type Criterion = { criterion_key: string; score: number; evidence_quote: string; rationale: string; grounded: boolean };
type ScoreRow = {
  id: string;
  role: "PM" | "SPM";
  rubricVersion: number;
  weightedTotal: number;
  criteria: unknown;
  flags: unknown;
  lowConfidence: boolean;
  createdAt: string;
};
type Draft = {
  id: string;
  kind: "invite" | "rejection";
  subject: string;
  bodyTemplate: string;
  source: string;
  status: string;
  sentTo: string | null;
  sentAt: string | null;
  error: string | null;
};
type Decision = { id: string; decision: "advance" | "hold" | "decline"; reason: string | null; decidedAt: string };

export default function CandidateClient(props: {
  candidate: {
    id: string;
    appliedRole: "PM" | "SPM";
    status: string;
    createdAt: string;
    firstOpenedAt: string | null;
    cvTextRedacted: string | null;
  };
  details: { fullName: string; email: string | null; phone: string | null; links: unknown; originalFilename: string } | null;
  fileMime: string | null;
  scores: ScoreRow[];
  brief: { who: string; why: string; probe: string; probes: unknown } | null;
  drafts: Draft[];
  decisions: Decision[];
  rubricNames: { PM: Record<string, string>; SPM: Record<string, string> };
}) {
  const router = useRouter();
  const { candidate, details, fileMime, scores, brief, decisions, rubricNames } = props;
  const canViewInline = fileMime === "application/pdf";
  const [drafts, setDrafts] = useState(props.drafts);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [ackLowConfidence, setAckLowConfidence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!candidate.firstOpenedAt) {
      fetch(`/api/candidates/${candidate.id}/open`, { method: "POST" }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id]);

  const primaryScore = scores.find((s) => s.role === candidate.appliedRole) ?? null;
  const secondaryScore = scores.find((s) => s.role !== candidate.appliedRole) ?? null;
  const names = rubricNames[candidate.appliedRole];

  const highlightedCV = useMemo(() => {
    if (!candidate.cvTextRedacted) return null;
    const quotes = ((primaryScore?.criteria as Criterion[]) ?? [])
      .map((c) => c.evidence_quote)
      .filter((q) => q && q.trim().length > 0);
    if (quotes.length === 0) return candidate.cvTextRedacted;
    let html = escapeHtml(candidate.cvTextRedacted);
    for (const q of quotes) {
      const esc = escapeHtml(q);
      if (!esc) continue;
      html = html.split(esc).join(`<mark>${esc}</mark>`);
    }
    return html;
  }, [candidate.cvTextRedacted, primaryScore]);

  async function submitIdentity() {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/candidates/${candidate.id}/identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: identityName, email: identityEmail }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      setMessage((await res.json()).error ?? "failed");
    }
  }

  async function recordDecision(decision: "advance" | "hold" | "decline") {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/candidates/${candidate.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason: decisionReason }),
    });
    setBusy(false);
    if (res.ok) {
      setDecisionReason("");
      router.refresh();
    } else {
      setMessage((await res.json()).error ?? "failed");
    }
  }

  async function saveDraft(draft: Draft, subject: string, body: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/candidates/${candidate.id}/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });
    setBusy(false);
    if (res.ok) {
      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, subject, bodyTemplate: body, source: "edited" } : d)));
    } else {
      setMessage((await res.json()).error ?? "failed to save draft");
    }
  }

  async function send(kind: "invite" | "rejection") {
    setBusy(true);
    setMessage(null);
    const check = await fetch(`/api/candidates/${candidate.id}/can-send?kind=${kind}`).then((r) => r.json());

    let placementConfirmed = false;
    if (!check.allowed) {
      // The one blocking reason that isn't a hard stop: the candidate's
      // current algorithmic placement contradicts this draft's kind (e.g. a
      // decline was correct when it was made, but the shortlist has since
      // moved and this candidate is back in it). Everything else blocking
      // the send is a hard stop with no override.
      const placementReason = (check.reasons as string[]).find((r) => r.includes("needs explicit confirmation"));
      const onlyPlacementBlocks = check.reasons.length === 1 && placementReason;
      if (!onlyPlacementBlocks) {
        setBusy(false);
        setMessage(`Send disabled: ${check.reasons.join("; ")}`);
        return;
      }
      if (!confirm(`Warning: ${placementReason}.\n\nSend this ${kind} anyway?`)) {
        setBusy(false);
        return;
      }
      placementConfirmed = true;
    }

    const res = await fetch(`/api/candidates/${candidate.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, acknowledgedLowConfidence: ackLowConfidence, placementConfirmed }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json();
      setMessage(body.error + (body.reasons ? `: ${body.reasons.join("; ")}` : ""));
    }
  }

  async function deleteCandidate() {
    if (!confirm(`Permanently delete ${details?.fullName ?? "this candidate"}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/candidates/${candidate.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.push("/");
    } else {
      setMessage("failed to delete");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{details?.fullName || "Name pending confirmation"}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${candidate.appliedRole === "PM" ? "bg-indigo-100 text-indigo-800" : "bg-violet-100 text-violet-800"}`}
            >
              {candidate.appliedRole}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[candidate.status] ?? "bg-gray-100 text-gray-700"}`}>
              {candidate.status.replace(/_/g, " ")}
            </span>
          </div>
          {details?.email && <p className="mt-1 text-sm text-gray-500">{details.email}</p>}
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/candidates/${candidate.id}/file`}
            target={canViewInline ? "_blank" : undefined}
            download={canViewInline ? undefined : (details?.originalFilename ?? true)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {canViewInline ? "View original CV" : "Download original CV"}
          </a>
          <button
            onClick={deleteCandidate}
            disabled={busy}
            className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
          >
            Delete candidate
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 shadow-sm">{message}</div>
      )}

      {candidate.status === "needs_identity_check" && (
        <div className="rounded-xl border-l-4 border-orange-400 border-y border-r border-gray-200 bg-orange-50/30 p-4 shadow-sm">
          <h2 className="mb-2 font-semibold text-gray-900">Confirm identity</h2>
          <p className="mb-3 text-sm text-gray-600">
            We couldn&apos;t confidently find this candidate&apos;s name in the CV. Type it in to continue the pipeline.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={identityName}
              onChange={(e) => setIdentityName(e.target.value)}
              placeholder="Full name"
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 focus:border-orange-400 focus:outline-none"
            />
            <input
              value={identityEmail}
              onChange={(e) => setIdentityEmail(e.target.value)}
              placeholder="Email"
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 focus:border-orange-400 focus:outline-none"
            />
            <button
              onClick={submitIdentity}
              disabled={busy}
              className="rounded-lg bg-orange-600 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {(candidate.status === "needs_manual_review" || candidate.status === "failed") && (
        <div className="rounded-xl border-l-4 border-rose-400 border-y border-r border-gray-200 bg-rose-50/30 p-4 text-sm text-gray-600 shadow-sm">
          This candidate is in <span className="font-medium text-rose-700">{candidate.status.replace(/_/g, " ")}</span> and was never scored.
        </div>
      )}

      {primaryScore && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-baseline gap-2 text-lg font-semibold text-gray-900">
              {candidate.appliedRole} score
              <span className={`text-2xl font-bold ${scoreTextColor(primaryScore.weightedTotal)}`}>
                {primaryScore.weightedTotal.toFixed(1)}
              </span>
            </h2>
            {secondaryScore && (
              <span className="text-sm text-gray-500">
                {secondaryScore.role} (secondary): <span className="font-medium">{secondaryScore.weightedTotal.toFixed(1)}</span>
              </span>
            )}
          </div>

          {(primaryScore.flags as string[]).length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {(primaryScore.flags as string[]).map((f) => (
                <span key={f} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  {f.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {(primaryScore.criteria as Criterion[]).map((c) => (
              <div key={c.criterion_key} className="border-t border-gray-100 pt-3">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="font-medium text-gray-800">{names[c.criterion_key] ?? c.criterion_key}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <div className="flex gap-0.5">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className={`h-2 w-4 rounded-sm ${i < c.score ? scoreBarColor(c.score) : "bg-gray-200"}`} />
                      ))}
                    </div>
                    <span className="text-sm font-semibold text-gray-600">{c.score}/4</span>
                  </div>
                </div>
                <p className="text-sm text-gray-600">{c.rationale}</p>
                {c.evidence_quote && <p className="text-sm italic text-gray-500">&ldquo;{c.evidence_quote}&rdquo;</p>}
                {!c.grounded && <p className="text-xs font-medium text-rose-600">Ungrounded evidence</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {brief && (
        <section className="rounded-xl border-l-4 border-indigo-400 border-y border-r border-gray-200 bg-indigo-50/30 p-4 shadow-sm">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">Interview brief</h2>
          <p className="mb-1 text-sm text-gray-700">{brief.who}</p>
          <p className="mb-1 text-sm text-gray-700">{brief.why}</p>
          <p className="mb-3 text-sm text-gray-700">{brief.probe}</p>
          <div className="space-y-0.5 text-xs text-indigo-700">
            {(brief.probes as string[]).map((p, i) => (
              <p key={i}>Probe: {p}</p>
            ))}
          </div>
        </section>
      )}

      {highlightedCV && (
        <details className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold text-gray-800">CV content (redacted, evidence highlighted)</summary>
          <pre
            className="mt-3 whitespace-pre-wrap text-xs text-gray-700 [&_mark]:rounded [&_mark]:bg-yellow-200 [&_mark]:px-0.5"
            dangerouslySetInnerHTML={{ __html: highlightedCV }}
          />
        </details>
      )}

      {drafts.map((d) => (
        <DraftEditor
          key={d.id}
          draft={d}
          firstName={details?.fullName?.split(/\s+/)[0] ?? "[NAME]"}
          recipientEmail={details?.email ?? null}
          lowConfidence={primaryScore?.lowConfidence ?? false}
          ackLowConfidence={ackLowConfidence}
          setAckLowConfidence={setAckLowConfidence}
          onSave={(subject, body) => saveDraft(d, subject, body)}
          onSend={() => send(d.kind)}
          busy={busy}
        />
      ))}

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Decision</h2>
        {decisions.length > 0 && (
          <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
            <span>Latest:</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                decisions[0].decision === "advance"
                  ? "bg-emerald-100 text-emerald-800"
                  : decisions[0].decision === "decline"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-gray-200 text-gray-700"
              }`}
            >
              {decisions[0].decision}
            </span>
            {decisions[0].reason && <span>{decisions[0].reason}</span>}
          </div>
        )}
        <textarea
          value={decisionReason}
          onChange={(e) => setDecisionReason(e.target.value)}
          placeholder="Reason (required if this goes against the system placement)"
          className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          rows={2}
        />
        <div className="flex gap-2">
          <button
            onClick={() => recordDecision("advance")}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            Advance
          </button>
          <button
            onClick={() => recordDecision("hold")}
            disabled={busy}
            className="rounded-lg bg-gray-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600 disabled:opacity-50"
          >
            Hold
          </button>
          <button
            onClick={() => recordDecision("decline")}
            disabled={busy}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      </section>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can throw in an insecure context or without permission --
      // the button just won't confirm; there's nothing else useful to do.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!value}
      className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
    >
      {copied ? "Copied" : `Copy ${label}`}
    </button>
  );
}

function DraftEditor(props: {
  draft: Draft;
  firstName: string;
  recipientEmail: string | null;
  lowConfidence: boolean;
  ackLowConfidence: boolean;
  setAckLowConfidence: (v: boolean) => void;
  onSave: (subject: string, body: string) => void;
  onSend: () => void;
  busy: boolean;
}) {
  const { draft, firstName, recipientEmail, lowConfidence, ackLowConfidence, setAckLowConfidence, onSave, onSend, busy } = props;
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.bodyTemplate);
  const [preview, setPreview] = useState(true);

  const displayed = preview ? body.replace("[NAME]", firstName) : body;

  const kindAccent = draft.kind === "invite" ? "border-emerald-400" : "border-rose-400";
  const statusColor =
    draft.status === "sent"
      ? "bg-emerald-100 text-emerald-800"
      : draft.status === "failed"
        ? "bg-rose-100 text-rose-800"
        : draft.status === "sending"
          ? "bg-amber-100 text-amber-800"
          : "bg-gray-100 text-gray-600";

  return (
    <section className={`rounded-xl border-l-4 ${kindAccent} border-y border-r border-gray-200 bg-white p-4 shadow-sm`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold capitalize text-gray-900">{draft.kind} draft</h2>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className={`rounded-full px-2 py-0.5 font-medium ${statusColor}`}>{draft.status}</span>
          <span>{draft.source}</span>
          {draft.sentTo && <span>sent to {draft.sentTo}</span>}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <CopyButton value={draft.sentTo ?? recipientEmail ?? ""} label="email" />
        <CopyButton value={subject} label="subject" />
        <CopyButton value={displayed} label="content" />
      </div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={preview}
        className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
      />
      <textarea
        value={displayed}
        onChange={(e) => !preview && setBody(e.target.value)}
        readOnly={preview}
        rows={8}
        className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
      />
      <label className="mb-2 flex items-center gap-2 text-xs text-gray-500">
        <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
        Preview with real name (uncheck to edit the [NAME] template)
      </label>
      {draft.kind === "rejection" && lowConfidence && (
        <label className="mb-2 flex items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <input type="checkbox" checked={ackLowConfidence} onChange={(e) => setAckLowConfidence(e.target.checked)} />
          I&apos;ve read the flags for this low-confidence candidate
        </label>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onSave(subject, body)}
          disabled={busy || draft.status === "sent"}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onSend}
          disabled={busy || draft.status === "sent"}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-40 ${
            draft.kind === "invite" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
          }`}
        >
          {draft.status === "sent" ? "Sent" : "Confirm & send"}
        </button>
      </div>
      {draft.error && <p className="mt-2 text-xs font-medium text-rose-600">{draft.error}</p>}
    </section>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
