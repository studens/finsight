import { notFound } from "next/navigation";
import React from "react";

import { FreeSummaryCards } from "../../../../components/FreeSummaryCards";
import { PremiumSection } from "../../../../components/PremiumSection";
import {
  getAnalysisById,
  getSessionUser,
  getSubscriptionStatus,
} from "../../../../lib/supabase/server";

interface AnalysisPageProps {
  params: Promise<{ analysisId: string }>;
}

export default async function AnalysisPage({ params }: AnalysisPageProps) {
  const { analysisId } = await params;
  const analysis = await getAnalysisById(analysisId);

  if (!analysis) notFound();

  const user = await getSessionUser();
  const status = user ? await getSubscriptionStatus(user.id) : "inactive";
  const isSubscribed = status === "active";

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12 text-left">
      <FreeSummaryCards summary={analysis.free_summary} />
      <PremiumSection analysisId={analysisId} isSubscribed={isSubscribed} />
    </main>
  );
}
