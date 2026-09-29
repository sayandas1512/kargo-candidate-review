"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Stage = "queued" | "ingesting" | "extracting" | "scoring" | "done" | "error";

type FileItem = {
  id: string;
  file: File;
  role: "PM" | "SPM";
  stage: Stage;
  candidateId?: string;
  note?: string;
  error?: string;
};

const CONCURRENCY = 3;
const MAX_RETRIES_429 = 5;

async function fetchWithBackoff(input: RequestInfo, init?: RequestInit): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(input, init);
    if (res.status !== 429 || attempt >= MAX_RETRIES_429) return res;
    const wait = Math.min(2 ** attempt * 500, 8000);
    await new Promise((r) => setTimeout(r, wait));
    attempt++;
  }
}

export default function UploadClient() {
  const [attested, setAttested] = useState<boolean | null>(null);
  const [attestChecked, setAttestChecked] = useState(false);
  const [items, setItems] = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const runningRef = useRef(false);

  useEffect(() => {
    fetch("/api/settings/attest")
      .then((r) => r.json())
      .then((d) => setAttested(Boolean(d.attested)))
      .catch(() => setAttested(false));
  }, []);

  async function confirmAttestation() {
    await fetch("/api/settings/attest", { method: "POST" });
    setAttested(true);
  }

  function addFiles(fileList: FileList | File[]) {
    const newItems: FileItem[] = Array.from(fileList).map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      role: "PM",
      stage: "queued",
    }));
    setItems((prev) => [...prev, ...newItems]);
  }

  const setItem = useCallback((id: string, patch: Partial<FileItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  async function processOne(item: FileItem) {
    try {
      setItem(item.id, { stage: "ingesting", error: undefined });
      const form = new FormData();
      form.append("file", item.file);
      form.append("appliedRole", item.role);
      const ingestRes = await fetchWithBackoff("/api/stages/ingest", { method: "POST", body: form });
      const ingestBody = await ingestRes.json();
      if (!ingestRes.ok) throw new Error(ingestBody.error ?? "ingest failed");

      if (ingestBody.status !== "uploaded") {
        setItem(item.id, { stage: "done", candidateId: ingestBody.candidateId, note: ingestBody.status });
        return;
      }
      const candidateId = ingestBody.candidateId as string;
      setItem(item.id, { candidateId, stage: "extracting" });

      const extractRes = await fetchWithBackoff("/api/stages/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (!extractRes.ok) throw new Error((await extractRes.json()).error ?? "extract failed");

      setItem(item.id, { stage: "scoring" });
      const scoreRes = await fetchWithBackoff("/api/stages/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (!scoreRes.ok) throw new Error((await scoreRes.json()).error ?? "score failed");

      setItem(item.id, { stage: "done", note: "scored" });
    } catch (err) {
      setItem(item.id, { stage: "error", error: String(err) });
    }
  }

  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    for (;;) {
      const pending = items.filter((it) => it.stage === "queued");
      if (pending.length === 0) break;
      const batch = pending.slice(0, CONCURRENCY);
      await Promise.all(batch.map((it) => processOne(it)));
    }

    runningRef.current = false;
    await fetchWithBackoff("/api/finalize", { method: "POST" }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function retry(id: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, stage: "queued", error: undefined } : it)));
  }

  function setRole(id: string, role: "PM" | "SPM") {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, role } : it)));
  }

  function startUpload() {
    setItems((prev) => prev.map((it) => (it.stage === "error" ? { ...it, stage: "queued" } : it)));
    runQueue();
  }

  if (attested === false) {
    return (
      <div className="rounded-xl border-l-4 border-amber-400 border-y border-r border-gray-200 bg-amber-50/40 p-6 shadow-sm">
        <h2 className="mb-2 font-semibold text-gray-900">Before you upload</h2>
        <p className="mb-4 text-sm text-gray-600">
          The Gemini key belongs to a project with billing enabled (free tier may use inputs to improve Google&apos;s
          models).
        </p>
        <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={attestChecked} onChange={(e) => setAttestChecked(e.target.checked)} />
          I understand
        </label>
        <button
          disabled={!attestChecked}
          onClick={confirmAttestation}
          className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    );
  }

  if (attested === null) return <p className="text-sm text-gray-500">Loading...</p>;

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-colors ${dragOver ? "border-indigo-400 bg-indigo-50" : "border-gray-300 bg-white"}`}
      >
        <p className="mb-3 text-sm text-gray-500">Drag &amp; drop PDF or DOCX files, or</p>
        <label className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">
          Choose files
          <input
            type="file"
            multiple
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </label>
      </div>

      {items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700">{it.file.name}</td>
                  <td className="px-3 py-2">
                    <select
                      value={it.role}
                      disabled={it.stage !== "queued"}
                      onChange={(e) => setRole(it.id, e.target.value as "PM" | "SPM")}
                      className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${it.role === "PM" ? "bg-indigo-100 text-indigo-800" : "bg-violet-100 text-violet-800"}`}
                    >
                      <option value="PM">PM</option>
                      <option value="SPM">SPM</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {it.stage === "error" ? (
                      <span className="font-medium text-rose-600">{it.error}</span>
                    ) : it.stage === "done" ? (
                      <span className="font-medium text-emerald-600">
                        {it.stage}
                        {it.note ? ` (${it.note.replace(/_/g, " ")})` : ""}
                      </span>
                    ) : (
                      <span className="font-medium text-sky-600">{it.stage}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {it.stage === "error" && (
                      <button onClick={() => retry(it.id)} className="font-medium text-indigo-600 hover:underline">
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.some((it) => it.stage === "queued") && (
        <button
          onClick={startUpload}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-700"
        >
          Start upload
        </button>
      )}
    </div>
  );
}
