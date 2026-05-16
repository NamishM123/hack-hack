"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import type { ApplicantInput, PredictionResult, ShapFactor } from "@/lib/types";

const FIELD_LABELS: Record<keyof ApplicantInput, string> = {
  annual_income: "Annual income",
  loan_amount: "Loan amount",
  loan_duration_months: "Loan duration",
  age: "Age",
  credit_history: "Credit history",
  employment_length: "Employment length",
  housing: "Housing",
  purpose: "Loan purpose",
};

// Ordered for UX; values match lib/feature_names.json categorical_options exactly.
const OPTIONS = {
  credit_history: ["paid back duly", "existing paid", "no credits", "delayed", "critical"],
  employment_length: ["unemployed", "<1 yr", "1-4 yrs", "4-7 yrs", "7+ yrs"],
  housing: ["own", "rent", "free"],
  purpose: ["car", "education", "business", "furniture", "other"],
};

const DEFAULTS: ApplicantInput = {
  annual_income: 48000,
  loan_amount: 4000,
  loan_duration_months: 24,
  age: 35,
  credit_history: "existing paid",
  employment_length: "1-4 yrs",
  housing: "own",
  purpose: "car",
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

// Phase 4 mock. Phase 5 replaces predict() with a real fetch to /api/predict.
function mockPredict(a: ApplicantInput): PredictionResult {
  const creditScore: Record<string, number> = {
    critical: -0.8,
    delayed: -0.4,
    "no credits": -0.1,
    "existing paid": 0.4,
    "paid back duly": 0.7,
  };
  const empScore: Record<string, number> = {
    unemployed: -0.6,
    "<1 yr": -0.2,
    "1-4 yrs": 0.1,
    "4-7 yrs": 0.35,
    "7+ yrs": 0.55,
  };
  const housingScore: Record<string, number> = { own: 0.25, rent: -0.05, free: -0.15 };
  const purposeScore: Record<string, number> = {
    business: -0.1,
    car: 0,
    education: 0.05,
    furniture: -0.05,
    other: -0.05,
  };

  const contributions: ShapFactor[] = [
    {
      feature: "annual_income",
      label: FIELD_LABELS.annual_income,
      value: ((a.annual_income - 40000) / 40000) * 0.6,
      direction: "increases",
    },
    {
      feature: "loan_amount",
      label: "Loan-to-income ratio",
      value: -(a.loan_amount / (a.annual_income + 1)) * 3,
      direction: "increases",
    },
    {
      feature: "loan_duration_months",
      label: FIELD_LABELS.loan_duration_months,
      value: -((a.loan_duration_months - 24) / 24) * 0.3,
      direction: "increases",
    },
    {
      feature: "credit_history",
      label: FIELD_LABELS.credit_history,
      value: creditScore[a.credit_history] ?? 0,
      direction: "increases",
    },
    {
      feature: "employment_length",
      label: FIELD_LABELS.employment_length,
      value: empScore[a.employment_length] ?? 0,
      direction: "increases",
    },
    {
      feature: "age",
      label: FIELD_LABELS.age,
      value: ((a.age - 35) / 35) * 0.2,
      direction: "increases",
    },
    {
      feature: "housing",
      label: FIELD_LABELS.housing,
      value: housingScore[a.housing] ?? 0,
      direction: "increases",
    },
    {
      feature: "purpose",
      label: FIELD_LABELS.purpose,
      value: purposeScore[a.purpose] ?? 0,
      direction: "increases",
    },
  ].map((c) => ({ ...c, direction: c.value >= 0 ? "increases" : "decreases" }));

  const z = contributions.reduce((s, c) => s + c.value, 0);
  const probability = sigmoid(z);
  const decision: "approved" | "denied" = probability >= 0.5 ? "approved" : "denied";
  const top_factors = [...contributions]
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
    .slice(0, 5);
  const top = top_factors[0];

  return {
    decision,
    probability,
    confidence: Math.max(probability, 1 - probability),
    top_factors,
    explanation: `Your application was ${decision} primarily because of ${top.label.toLowerCase()} (${
      top.direction === "increases" ? "raising" : "lowering"
    } the approval likelihood).`,
    is_mock: true,
  };
}

async function predict(a: ApplicantInput): Promise<PredictionResult> {
  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a),
    });
    if (res.ok) return (await res.json()) as PredictionResult;
  } catch {
    // network/404 — local `next dev` does not serve Python functions.
  }
  // Fallback keeps the demo working when the Python endpoint is unavailable;
  // the result panel's "mock" pill makes the fallback visible.
  await new Promise((r) => setTimeout(r, 400));
  return mockPredict(a);
}

export default function Home() {
  const [form, setForm] = useState<ApplicantInput>(DEFAULTS);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof ApplicantInput>(k: K, v: ApplicantInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const r = await predict(form);
    setResult(r);
    setLoading(false);
  }

  return (
    <main>
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12 animate-fade-in">
          <p className="text-sm font-medium uppercase tracking-wider text-blue-600">
            FairScore
          </p>
          <h1 className="mt-2 max-w-2xl text-4xl font-bold tracking-tight">
            See the decision <span className="text-blue-600">and</span> the bias
            behind loan-approval AI
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Submit an application to get a model decision with a SHAP
            explanation of what drove it — then run a batch{" "}
            <a
              href="/audit"
              className="font-medium text-blue-600 underline-offset-2 hover:underline"
            >
              fairness audit
            </a>{" "}
            to see how the same model treats different groups across four
            fairness metrics.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5 py-10">
        <header className="animate-fade-in">
          <h2 className="text-2xl font-bold tracking-tight">
            Loan application
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Submit an application to see the model&apos;s decision and the
            factors that drove it.
          </p>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Form */}
          <form
            onSubmit={onSubmit}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm animate-fade-in-up"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField
                label={FIELD_LABELS.annual_income}
                value={form.annual_income}
                min={0}
                step={1000}
                prefix="$"
                onChange={(v) => set("annual_income", v)}
              />
              <NumberField
                label={FIELD_LABELS.loan_amount}
                value={form.loan_amount}
                min={0}
                step={500}
                prefix="$"
                onChange={(v) => set("loan_amount", v)}
              />
              <NumberField
                label={`${FIELD_LABELS.loan_duration_months} (months)`}
                value={form.loan_duration_months}
                min={1}
                step={1}
                onChange={(v) => set("loan_duration_months", v)}
              />
              <NumberField
                label={FIELD_LABELS.age}
                value={form.age}
                min={18}
                step={1}
                onChange={(v) => set("age", v)}
              />
              <SelectField
                label={FIELD_LABELS.credit_history}
                value={form.credit_history}
                options={OPTIONS.credit_history}
                onChange={(v) => set("credit_history", v)}
              />
              <SelectField
                label={FIELD_LABELS.employment_length}
                value={form.employment_length}
                options={OPTIONS.employment_length}
                onChange={(v) => set("employment_length", v)}
              />
              <SelectField
                label={FIELD_LABELS.housing}
                value={form.housing}
                options={OPTIONS.housing}
                onChange={(v) => set("housing", v)}
              />
              <SelectField
                label={FIELD_LABELS.purpose}
                value={form.purpose}
                options={OPTIONS.purpose}
                onChange={(v) => set("purpose", v)}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Scoring application…" : "Check decision"}
            </button>
          </form>

          {/* Result */}
          <div className="lg:sticky lg:top-6 self-start">
            {!result && !loading && (
              <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 p-6 text-center text-sm text-slate-400">
                Submit the form to see the decision and top factors.
              </div>
            )}
            {loading && <ResultSkeleton />}
            {result && !loading && <ResultPanel result={result} />}
          </div>
        </div>
      </div>
    </main>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step,
  prefix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  prefix?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
        {prefix && (
          <span className="pl-3 text-sm text-slate-400">{prefix}</span>
        )}
        <input
          type="number"
          required
          min={min}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full bg-transparent px-3 py-2 text-sm outline-none"
        />
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm capitalize outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      >
        {options.map((o) => (
          <option key={o} value={o} className="capitalize">
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200" />
          <div className="space-y-2">
            <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
        <div className="mt-4 h-3 w-full animate-pulse rounded bg-slate-100" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-4 w-56 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
              <div className="h-2 w-full animate-pulse rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: PredictionResult }) {
  const approved = result.decision === "approved";
  const maxAbs = Math.max(...result.top_factors.map((f) => Math.abs(f.value)), 0.001);

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div
        className={`rounded-xl border p-6 shadow-sm ${
          approved
            ? "border-emerald-200 bg-emerald-50"
            : "border-red-200 bg-red-50"
        }`}
      >
        <div className="flex items-center gap-3">
          {approved ? (
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          ) : (
            <XCircle className="h-8 w-8 text-red-600" />
          )}
          <div>
            <p
              className={`text-2xl font-bold ${
                approved ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {approved ? "Approved" : "Denied"}
            </p>
            <p className="text-sm text-slate-600">
              Confidence {(result.confidence * 100).toFixed(1)}% · P(approve){" "}
              {(result.probability * 100).toFixed(1)}%
            </p>
          </div>
          {result.is_mock && (
            <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
              mock
            </span>
          )}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-700">
          {result.explanation}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">
          Top 5 factors driving this decision
        </h2>
        <ul className="mt-4 space-y-3">
          {result.top_factors.map((f) => {
            const up = f.direction === "increases";
            const w = (Math.abs(f.value) / maxAbs) * 100;
            return (
              <li key={f.feature}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">{f.label}</span>
                  <span
                    className={`inline-flex items-center gap-1 tabular-nums ${
                      up ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {up ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5" />
                    )}
                    {f.value >= 0 ? "+" : ""}
                    {f.value.toFixed(3)}
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      up ? "bg-emerald-500" : "bg-red-500"
                    }`}
                    style={{ width: `${w}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-slate-400">
          Green factors pushed toward approval; red pushed toward denial.
        </p>
      </div>
    </div>
  );
}
