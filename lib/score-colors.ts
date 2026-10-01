export function scoreTextColor(total: number): string {
  if (total >= 80) return "text-emerald-600";
  if (total >= 60) return "text-lime-600";
  if (total >= 40) return "text-amber-600";
  return "text-rose-600";
}

export function scoreBarColor(score: number): string {
  return ["bg-gray-300", "bg-rose-400", "bg-amber-400", "bg-lime-500", "bg-emerald-500"][score] ?? "bg-gray-300";
}

export const STATUS_STYLES: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-800",
  scored: "bg-amber-100 text-amber-800",
  extracted: "bg-sky-100 text-sky-800",
  uploaded: "bg-sky-100 text-sky-800",
  needs_manual_review: "bg-rose-100 text-rose-800",
  needs_identity_check: "bg-orange-100 text-orange-800",
  failed: "bg-rose-100 text-rose-800",
};
