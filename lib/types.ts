// ---- Single prediction contract (form <-> api/predict.py) ----

export interface ApplicantInput {
  annual_income: number;
  loan_amount: number;
  loan_duration_months: number;
  age: number;
  credit_history: string;
  employment_length: string;
  housing: string;
  purpose: string;
}

export interface ShapFactor {
  feature: string; // raw feature key
  label: string; // human label
  value: number; // signed SHAP contribution toward approval
  direction: "increases" | "decreases";
}

export interface PredictionResult {
  decision: "approved" | "denied";
  probability: number; // P(approve), 0..1
  confidence: number; // 0..1, = max(p, 1-p)
  top_factors: ShapFactor[]; // top 5 by |value|
  explanation: string;
  is_mock: boolean;
}

// Shared contract for the fairness audit. The Phase 6 Python endpoint
// (api/audit.py) returns this exact shape; the mock JSON mirrors it.

export interface FairnessMetric {
  key: "demographic_parity" | "equal_opportunity" | "predictive_parity" | "calibration";
  label: string;
  value: number; // disparity/difference: 0 = perfectly fair, higher = less fair
  ci_lower: number;
  ci_upper: number;
  description: string;
}

export interface GroupRate {
  group: string;
  approval_rate: number;
  n: number;
}

export interface WorstDimension {
  metric: FairnessMetric["key"];
  label: string;
  value: number;
  explanation: string;
}

export interface IntersectionalCell {
  approval_rate: number;
  n: number;
}

export interface Intersectional {
  rows: string;
  cols: string;
  row_values: string[];
  col_values: string[];
  cells: IntersectionalCell[][]; // [rowIndex][colIndex]
}

export interface AuditResult {
  generated_at: string;
  sample_size: number;
  is_mock: boolean;
  overall_fairscore: number; // 0..1, higher = fairer
  metrics: FairnessMetric[];
  per_group: Record<string, GroupRate[]>;
  worst_dimension: WorstDimension;
  intersectional: Intersectional;
}

// Status thresholds for a disparity metric (lower is fairer).
export type StatusLevel = "good" | "warn" | "bad";

export function metricStatus(value: number): StatusLevel {
  if (value < 0.05) return "good";
  if (value <= 0.1) return "warn";
  return "bad";
}

// FairScore gauge band: >0.9 green, 0.8–0.9 yellow, <0.8 red.
export function scoreStatus(score: number): StatusLevel {
  if (score > 0.9) return "good";
  if (score >= 0.8) return "warn";
  return "bad";
}

export const STATUS_UI: Record<
  StatusLevel,
  { label: string; text: string; bg: string; ring: string; hex: string }
> = {
  good: {
    label: "Pass",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    ring: "ring-emerald-500",
    hex: "#10b981",
  },
  warn: {
    label: "Watch",
    text: "text-amber-700",
    bg: "bg-amber-50",
    ring: "ring-amber-500",
    hex: "#f59e0b",
  },
  bad: {
    label: "Concern",
    text: "text-red-700",
    bg: "bg-red-50",
    ring: "ring-red-500",
    hex: "#ef4444",
  },
};
