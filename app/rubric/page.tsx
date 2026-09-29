import { getRubricCriteria } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

type Criterion = {
  criterion_key: string;
  name: string;
  weight: number;
  measures: string;
  anchors: { "0": string; "2": string; "4": string };
  probe: string;
};

async function RoleRubric({ role }: { role: "PM" | "SPM" }) {
  const { version, criteria } = await getRubricCriteria(role);
  const sum = (criteria as Criterion[]).reduce((s, c) => s + c.weight, 0);
  const accent = role === "PM" ? "border-indigo-500" : "border-violet-500";
  const weightBg = role === "PM" ? "bg-indigo-50 text-indigo-700" : "bg-violet-50 text-violet-700";

  return (
    <section className={`rounded-xl border-l-4 ${accent} border-y border-r border-gray-200 bg-white p-5 shadow-sm`}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{role}</h2>
        <span className="text-sm text-gray-400">v{version}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${sum === 100 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}
        >
          {sum === 100 ? "Sums to 100" : `Sums to ${sum}`}
        </span>
      </div>
      <div className="space-y-4">
        {(criteria as Criterion[]).map((c) => (
          <div key={c.criterion_key} className="border-t border-gray-100 pt-3">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="font-medium text-gray-800">{c.criterion_key}</span>
              <span className="text-gray-700">{c.name}</span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${weightBg}`}>{c.weight}%</span>
            </div>
            <p className="mb-2 text-sm text-gray-600">{c.measures}</p>
            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-lg bg-rose-50 p-2 text-rose-800">
                <span className="font-semibold">0:</span> {c.anchors["0"]}
              </div>
              <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
                <span className="font-semibold">2:</span> {c.anchors["2"]}
              </div>
              <div className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
                <span className="font-semibold">4:</span> {c.anchors["4"]}
              </div>
            </div>
            <p className="mt-2 text-xs italic text-gray-400">Probe: {c.probe}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function RubricPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Active rubric</h1>
      <RoleRubric role="PM" />
      <RoleRubric role="SPM" />
    </div>
  );
}
