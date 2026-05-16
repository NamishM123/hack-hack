import type { Metadata } from "next";
import "./globals.css";
import NavBar from "./nav";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://hack-hack.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "FairScore — Bias detection for loan-approval AI",
  description:
    "FairScore predicts loan decisions, explains them with SHAP, and audits the model for bias across four fairness metrics with confidence intervals.",
  openGraph: {
    title: "FairScore — Bias detection for loan-approval AI",
    description:
      "Predict, explain, and audit a loan-approval model for fairness — four metrics, confidence intervals, intersectional analysis.",
    type: "website",
    url: SITE_URL,
    siteName: "FairScore",
  },
  twitter: {
    card: "summary",
    title: "FairScore — Bias detection for loan-approval AI",
    description:
      "Predict, explain, and audit a loan-approval model for fairness.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased">
        <NavBar />
        <div className="flex-1">{children}</div>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-6 text-xs leading-relaxed text-slate-500">
            <p className="font-medium text-slate-600">
              No single fairness metric is universally correct. FairScore shows
              multiple metrics so users can see tradeoffs.
            </p>
            <p className="mt-2">
              Educational demo. Model trained on the German Credit dataset;
              <span className="ml-1">
                annual income and sensitive attributes are partly synthesized
                for illustration.
              </span>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
