"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ErrorBar,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import mockData from "@/lib/mock_audit_results.json";
import {
  type AuditResult,
  metricStatus,
  scoreStatus,
  STATUS_UI,
} from "@/lib/types";

const MOCK = mockData as unknown as AuditResult;

const fmt3 = (n: number) => n.toFixed(3);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function AuditPage() {
  const [data, setData] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Phase 3: read from the mock file. Phase 6 swaps this for /api/audit.
    setData(MOCK);
  }, []);

  async function runNewAudit() {
    setLoading(true);
    try {
      const res = await fetch("/api/audit", { method: "POST" });
      if (res.ok) {
        setData((await res.json()) as AuditResult);
        setLoading(false);
        return;
      }
    } catch {
      // local `next dev` does not serve Python functions — fall back to mock.
    }
    await new Promise((r) => setTimeout(r, 600));
    setData({ ...MOCK, generated_at: new Date().toISOString() });
    setLoading(false);
  }

  if (!data) {
    return (
      <main className="grid min-h-[60vh] place-items-center">
        <div className="flex items-center gap-3 text-slate-500">
          <RefreshCw className="h-5 w-5 animate-spin" />
          Loading audit…
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="mx-auto max-w-6xl px-5 py-10">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-in">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-blue-600">
              FairScore
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Fairness Audit
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Batch audit of the loan model across {data.sample_size} held-out
              applicants
              {data.is_mock && (
                <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                  mock data
                </span>
              )}
            </p>
          </div>
          <button
            onClick={runNewAudit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Running audit…" : "Run New Audit"}
          </button>
        </header>

        {loading ? (
          <DashboardSkeleton />
        ) : (
        <>
        {/* FairScore gauge */}
        <section
          className="mt-8 animate-fade-in-up"
          style={{ animationDelay: "60ms" }}
        >
          <FairScoreGauge score={data.overall_fairscore} />
        </section>

        {/* Metric cards */}
        <section
          className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up"
          style={{ animationDelay: "120ms" }}
        >
          {data.metrics.map((m) => {
            const s = STATUS_UI[metricStatus(m.value)];
            return (
              <div
                key={m.key}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">
                    {m.label}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}
                  >
                    {s.label}
                  </span>
                </div>
                <p className="mt-3 text-3xl font-bold tabular-nums">
                  {fmt3(m.value)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  95% CI [{fmt3(m.ci_lower)}, {fmt3(m.ci_upper)}]
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  {m.description}
                </p>
              </div>
            );
          })}
        </section>

        {/* Bar chart with error bars */}
        <section
          className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm animate-fade-in-up"
          style={{ animationDelay: "180ms" }}
        >
          <h2 className="text-base font-semibold">
            Disparity by metric{" "}
            <span className="font-normal text-slate-400">
              (lower is fairer · bars show 95% CI)
            </span>
          </h2>
          <div className="mt-4">
            <MetricsBarChart data={data} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
            <Legend hex={STATUS_UI.good.hex} label="< 0.05 pass" />
            <Legend hex={STATUS_UI.warn.hex} label="0.05–0.10 watch" />
            <Legend hex={STATUS_UI.bad.hex} label="> 0.10 concern" />
          </div>
        </section>

        {/* Worst dimension callout */}
        <section
          className="mt-6 animate-fade-in-up"
          style={{ animationDelay: "240ms" }}
        >
          <WorstDimensionCallout data={data} />
        </section>

        {/* Intersectional heatmap */}
        <section
          className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm animate-fade-in-up"
          style={{ animationDelay: "300ms" }}
        >
          <h2 className="text-base font-semibold">
            Intersectional approval rates
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {data.intersectional.rows} × {data.intersectional.cols} — approval
            rate (sample size)
          </p>
          <div className="mt-4">
            <Heatmap data={data} />
          </div>
        </section>
        </>
        )}
      </div>
    </main>
  );
}

function SkelCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}
    >
      <div className="h-4 w-1/3 rounded bg-slate-200" />
      <div className="mt-4 h-8 w-1/2 rounded bg-slate-200" />
      <div className="mt-3 h-3 w-2/3 rounded bg-slate-100" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="mt-8 flex items-center justify-center gap-12 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="h-52 w-52 animate-pulse rounded-full bg-slate-200" />
        <div className="hidden space-y-3 sm:block">
          <div className="h-6 w-40 animate-pulse rounded-full bg-slate-200" />
          <div className="h-3 w-64 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-56 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkelCard key={i} />
        ))}
      </div>
      <SkelCard className="mt-6 h-64" />
      <SkelCard className="mt-6" />
      <SkelCard className="mt-6 h-48" />
    </div>
  );
}

function Legend({ hex, label }: { hex: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: hex }}
      />
      {label}
    </span>
  );
}

function FairScoreGauge({ score }: { score: number }) {
  const status = scoreStatus(score);
  const ui = STATUS_UI[status];
  const R = 80;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(1, score));

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white p-8 shadow-sm sm:flex-row sm:justify-center sm:gap-12">
      <div className="relative h-52 w-52">
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="16"
          />
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke={ui.hex}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - clamped)}
            style={{ transition: "stroke-dashoffset 700ms ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-bold tabular-nums">
            {score.toFixed(2)}
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            FairScore
          </span>
        </div>
      </div>
      <div className="max-w-xs text-center sm:text-left">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${ui.bg} ${ui.text}`}
        >
          <ShieldCheck className="h-4 w-4" />
          {status === "good"
            ? "Fair"
            : status === "warn"
              ? "Needs attention"
              : "Significant bias"}
        </span>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          A composite of four fairness metrics on a 0–1 scale. Above 0.90 is
          considered fair, 0.80–0.90 warrants review, and below 0.80 signals
          significant disparity.
        </p>
      </div>
    </div>
  );
}

function MetricsBarChart({ data }: { data: AuditResult }) {
  const chartData = data.metrics.map((m) => ({
    label: m.label,
    value: m.value,
    ci: [m.value - m.ci_lower, m.ci_upper - m.value] as [number, number],
    hex: STATUS_UI[metricStatus(m.value)].hex,
  }));
  const max = Math.max(...data.metrics.map((m) => m.ci_upper)) * 1.15;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
      >
        <XAxis
          type="number"
          domain={[0, Number(max.toFixed(2))]}
          tick={{ fontSize: 12, fill: "#64748b" }}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={130}
          tick={{ fontSize: 12, fill: "#334155" }}
        />
        <Tooltip
          formatter={(value) =>
            fmt3(typeof value === "number" ? value : Number(value ?? 0))
          }
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <ReferenceLine x={0.05} stroke="#10b981" strokeDasharray="4 4" />
        <ReferenceLine x={0.1} stroke="#ef4444" strokeDasharray="4 4" />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={26}>
          {chartData.map((d, i) => (
            <Cell key={i} fill={d.hex} />
          ))}
          <ErrorBar
            dataKey="ci"
            width={5}
            strokeWidth={2}
            stroke="#475569"
            direction="x"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function WorstDimensionCallout({ data }: { data: AuditResult }) {
  const w = data.worst_dimension;
  const ui = STATUS_UI[metricStatus(w.value)];
  return (
    <div
      className={`rounded-xl border p-6 shadow-sm ${ui.bg} border-slate-200`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white ${ui.text}`}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold">
            Worst dimension: {w.label}{" "}
            <span className="tabular-nums text-slate-500">
              ({fmt3(w.value)})
            </span>
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            {w.explanation}
          </p>
        </div>
      </div>
    </div>
  );
}

function heatColor(rate: number) {
  // red (low) -> amber -> green (high)
  const hue = Math.round(Math.max(0, Math.min(1, rate)) * 120);
  return { backgroundColor: `hsl(${hue} 75% 90%)`, color: `hsl(${hue} 60% 25%)` };
}

function Heatmap({ data }: { data: AuditResult }) {
  const x = data.intersectional;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="p-2 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
              {x.rows} \ {x.cols}
            </th>
            {x.col_values.map((c) => (
              <th
                key={c}
                className="p-2 text-center text-xs font-semibold capitalize text-slate-600"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {x.row_values.map((rv, ri) => (
            <tr key={rv}>
              <td className="p-2 text-xs font-semibold capitalize text-slate-600">
                {rv}
              </td>
              {x.col_values.map((_, ci) => {
                const cell = x.cells[ri][ci];
                return (
                  <td
                    key={ci}
                    className="rounded-lg p-3 text-center"
                    style={heatColor(cell.approval_rate)}
                  >
                    <div className="text-base font-bold tabular-nums">
                      {pct(cell.approval_rate)}
                    </div>
                    <div className="text-[11px] opacity-70">n={cell.n}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
