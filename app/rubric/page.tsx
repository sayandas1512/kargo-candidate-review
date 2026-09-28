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

  return (
    <section className="rounded border bg-white p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">{role}</h2>
        <span className="text-sm text-gray-500">v{version}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${sum === 100 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
          {sum === 100 ? "sums to 100" : `sums to ${sum}`}
        </span>
      </div>
      <div className="space-y-4">
        {(criteria as Criterion[]).map((c) => (
          <div key={c.criterion_key} className="border-t pt-3">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="font-medium">{c.criterion_key}</span>
              <span>{c.name}</span>
              <span className="ml-auto text-sm text-gray-500">{c.weight}%</span>
            </div>
            <p className="mb-2 text-sm text-gray-600">{c.measures}</p>
            <div className="grid grid-cols-1 gap-1 text-xs text-gray-500 sm:grid-cols-3">
              <div><span className="font-medium">0:</span> {c.anchors["0"]}</div>
              <div><span className="font-medium">2:</span> {c.anchors["2"]}</div>
              <div><span className="font-medium">4:</span> {c.anchors["4"]}</div>
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
      <h1 className="text-2xl font-semibold">Active rubric</h1>
      <RoleRubric role="PM" />
      <RoleRubric role="SPM" />
    </div>
  );
}
