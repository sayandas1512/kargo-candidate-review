const MONTH_RE = /^(\d{4})-(\d{1,2})$/;
const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

function parseDate(raw: string, now: Date): Date | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "present" || s === "current" || s === "now") return now;

  const iso = MONTH_RE.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, 1);

  const yearOnly = /^(\d{4})$/.exec(s);
  if (yearOnly) return new Date(Number(yearOnly[1]), 0, 1);

  const monthYear = /^([a-z]{3,9})[.\s]*'?(\d{2,4})$/.exec(s);
  if (monthYear) {
    const idx = MONTH_NAMES.findIndex((m) => monthYear[1].startsWith(m));
    if (idx >= 0) {
      let year = Number(monthYear[2]);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      return new Date(year, idx, 1);
    }
  }

  return null;
}

/**
 * Total years of professional experience, computed in code from the
 * extracted role dates -- never asked of the model. Overlapping roles are
 * merged so concurrent jobs are not double-counted.
 */
export function computeTotalYearsExperience(
  roles: { start: string; end: string }[],
  now: Date = new Date(),
): number {
  const intervals = roles
    .map((r) => {
      const start = parseDate(r.start, now);
      const end = parseDate(r.end, now) ?? now;
      if (!start) return null;
      return { start: start.getTime(), end: Math.max(end.getTime(), start.getTime()) };
    })
    .filter((x): x is { start: number; end: number } => x !== null)
    .sort((a, b) => a.start - b.start);

  if (intervals.length === 0) return 0;

  const merged: { start: number; end: number }[] = [intervals[0]];
  for (const cur of intervals.slice(1)) {
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push(cur);
    }
  }

  const msTotal = merged.reduce((sum, m) => sum + (m.end - m.start), 0);
  const years = msTotal / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(years * 10) / 10;
}

export const JD_EXPERIENCE_RANGE: Record<"PM" | "SPM", [number, number]> = {
  PM: [2, 4],
  SPM: [5, 8],
};

export function isExperienceOutsideRange(years: number, role: "PM" | "SPM"): boolean {
  const [min, max] = JD_EXPERIENCE_RANGE[role];
  return years < min || years > max;
}
