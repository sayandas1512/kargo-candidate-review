"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
  scores: ScoreRow[];
  brief: { who: string; why: string; probe: string; probes: unknown } | null;
  drafts: Draft[];
  decisions: Decision[];
  rubricNames: { PM: Record<string, string>; SPM: Record<string, string> };
}) {
  const router = useRouter();
  const { candidate, details, scores, brief, decisions, rubricNames } = props;
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
    if (!check.allowed) {
      setBusy(false);
      setMessage(`Send disabled: ${check.reasons.join("; ")}`);
      return;
    }
    const res = await fetch(`/api/candidates/${candidate.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, acknowledgedLowConfidence: ackLowConfidence }),
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
          <h1 className="text-2xl font-semibold">{details?.fullName || "Name pending confirmation"}</h1>
          <p className="text-sm text-gray-500">
            Applied: {candidate.appliedRole} · Status: {candidate.status}
          </p>
          {details?.email && <p className="text-sm text-gray-500">{details.email}</p>}
        </div>
        <div className="flex gap-2">
          <a href={`/api/candidates/${candidate.id}/file`} target="_blank" className="rounded border px-3 py-1.5 text-sm">
            View original CV
          </a>
          <button onClick={deleteCandidate} disabled={busy} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">
            Delete candidate
          </button>
        </div>
      </div>

      {message && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}

      {candidate.status === "needs_identity_check" && (
        <div className="rounded border bg-white p-4">
          <h2 className="mb-2 font-semibold">Confirm identity</h2>
          <p className="mb-3 text-sm text-gray-500">
            We couldn&apos;t confidently find this candidate&apos;s name in the CV. Type it in to continue the pipeline.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={identityName}
              onChange={(e) => setIdentityName(e.target.value)}
              placeholder="Full name"
              className="flex-1 rounded border px-3 py-2"
            />
            <input
              value={identityEmail}
              onChange={(e) => setIdentityEmail(e.target.value)}
              placeholder="Email"
              className="flex-1 rounded border px-3 py-2"
            />
            <button onClick={submitIdentity} disabled={busy} className="rounded bg-black px-4 py-2 text-white">
              Confirm
            </button>
          </div>
        </div>
      )}

      {(candidate.status === "needs_manual_review" || candidate.status === "failed") && (
        <div className="rounded border bg-white p-4 text-sm text-gray-600">
          This candidate is in <span className="font-medium">{candidate.status}</span> and was never scored.
        </div>
      )}

      {primaryScore && (
        <section className="rounded border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {candidate.appliedRole} score: {primaryScore.weightedTotal.toFixed(1)}
            </h2>
            {secondaryScore && (
              <span className="text-sm text-gray-500">
                {secondaryScore.role} (secondary): {secondaryScore.weightedTotal.toFixed(1)}
              </span>
            )}
          </div>

          {(primaryScore.flags as string[]).length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {(primaryScore.flags as string[]).map((f) => (
                <span key={f} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {f}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {(primaryScore.criteria as Criterion[]).map((c) => (
              <div key={c.criterion_key} className="border-t pt-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-medium">{names[c.criterion_key] ?? c.criterion_key}</span>
                  <span>{c.score}/4</span>
                </div>
                <p className="text-sm text-gray-600">{c.rationale}</p>
                {c.evidence_quote && <p className="text-sm italic text-gray-500">&ldquo;{c.evidence_quote}&rdquo;</p>}
                {!c.grounded && <p className="text-xs text-red-600">ungrounded evidence</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {brief && (
        <section className="rounded border bg-white p-4">
          <h2 className="mb-2 text-lg font-semibold">Interview brief</h2>
          <p className="mb-1 text-sm">{brief.who}</p>
          <p className="mb-1 text-sm">{brief.why}</p>
          <p className="mb-3 text-sm">{brief.probe}</p>
          <div className="text-xs text-gray-500">
            {(brief.probes as string[]).map((p, i) => (
              <p key={i}>Probe: {p}</p>
            ))}
          </div>
        </section>
      )}

      {highlightedCV && (
        <details className="rounded border bg-white p-4">
          <summary className="cursor-pointer font-semibold">CV content (redacted, evidence highlighted)</summary>
          <pre
            className="mt-3 whitespace-pre-wrap text-xs text-gray-700 [&_mark]:bg-yellow-200"
            dangerouslySetInnerHTML={{ __html: highlightedCV }}
          />
        </details>
      )}

      {drafts.map((d) => (
        <DraftEditor
          key={d.id}
          draft={d}
          firstName={details?.fullName?.split(/\s+/)[0] ?? "[NAME]"}
          lowConfidence={primaryScore?.lowConfidence ?? false}
          ackLowConfidence={ackLowConfidence}
          setAckLowConfidence={setAckLowConfidence}
          onSave={(subject, body) => saveDraft(d, subject, body)}
          onSend={() => send(d.kind)}
          busy={busy}
        />
      ))}

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">Decision</h2>
        {decisions.length > 0 && (
          <div className="mb-3 text-sm text-gray-500">
            Latest: <span className="font-medium">{decisions[0].decision}</span>
            {decisions[0].reason && <> — {decisions[0].reason}</>}
          </div>
        )}
        <textarea
          value={decisionReason}
          onChange={(e) => setDecisionReason(e.target.value)}
          placeholder="Reason (required if this goes against the system placement)"
          className="mb-2 w-full rounded border px-3 py-2 text-sm"
          rows={2}
        />
        <div className="flex gap-2">
          <button onClick={() => recordDecision("advance")} disabled={busy} className="rounded bg-green-700 px-4 py-2 text-sm text-white">
            Advance
          </button>
          <button onClick={() => recordDecision("hold")} disabled={busy} className="rounded bg-gray-500 px-4 py-2 text-sm text-white">
            Hold
          </button>
          <button onClick={() => recordDecision("decline")} disabled={busy} className="rounded bg-red-700 px-4 py-2 text-sm text-white">
            Decline
          </button>
        </div>
      </section>
    </div>
  );
}

function DraftEditor(props: {
  draft: Draft;
  firstName: string;
  lowConfidence: boolean;
  ackLowConfidence: boolean;
  setAckLowConfidence: (v: boolean) => void;
  onSave: (subject: string, body: string) => void;
  onSend: () => void;
  busy: boolean;
}) {
  const { draft, firstName, lowConfidence, ackLowConfidence, setAckLowConfidence, onSave, onSend, busy } = props;
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.bodyTemplate);
  const [preview, setPreview] = useState(true);

  const displayed = preview ? body.replace("[NAME]", firstName) : body;

  return (
    <section className="rounded border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold capitalize">{draft.kind} draft</h2>
        <span className="text-xs text-gray-500">
          {draft.status} · {draft.source}
          {draft.sentTo ? ` · sent to ${draft.sentTo}` : ""}
        </span>
      </div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={preview} className="mb-2 w-full rounded border px-3 py-2 text-sm disabled:bg-gray-50" />
      <textarea
        value={displayed}
        onChange={(e) => !preview && setBody(e.target.value)}
        readOnly={preview}
        rows={8}
        className="mb-2 w-full rounded border px-3 py-2 text-sm disabled:bg-gray-50"
      />
      <label className="mb-2 flex items-center gap-2 text-xs text-gray-500">
        <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
        Preview with real name (uncheck to edit the [NAME] template)
      </label>
      {draft.kind === "rejection" && lowConfidence && (
        <label className="mb-2 flex items-center gap-2 text-xs text-amber-700">
          <input type="checkbox" checked={ackLowConfidence} onChange={(e) => setAckLowConfidence(e.target.checked)} />
          I&apos;ve read the flags for this low-confidence candidate
        </label>
      )}
      <div className="flex gap-2">
        <button onClick={() => onSave(subject, body)} disabled={busy || draft.status === "sent"} className="rounded border px-4 py-2 text-sm">
          Save
        </button>
        <button
          onClick={onSend}
          disabled={busy || draft.status === "sent"}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {draft.status === "sent" ? "Sent" : "Confirm & send"}
        </button>
      </div>
      {draft.error && <p className="mt-2 text-xs text-red-600">{draft.error}</p>}
    </section>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
