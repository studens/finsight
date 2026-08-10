import React from "react";

import { CheckoutSuccessBanner } from "../../../components/CheckoutSuccessBanner";
import { HistoryList } from "../../../components/HistoryList";
import { UploadFlow } from "../../../components/UploadFlow";
import {
  getSessionUser,
  getSubscriptionStatus,
  listUserAnalyses,
} from "../../../lib/supabase/server";

interface DashboardPageProps {
  searchParams: Promise<{ checkout?: string | string[] }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { checkout } = await searchParams;
  const user = await getSessionUser();
  const [status, analyses] = await Promise.all([
    user ? getSubscriptionStatus(user.id) : Promise.resolve("inactive" as const),
    listUserAnalyses(),
  ]);
  const isSubscribed = status === "active";
  const history = analyses.map(({ id, createdAt, freeSummary }) => ({
    id,
    createdAt,
    totalSpent: freeSummary.totalSpent,
    transactionCount: freeSummary.transactionCount,
  }));

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12 text-left">
      {checkout === "success" ? (
        <CheckoutSuccessBanner isSubscribed={isSubscribed} />
      ) : null}
      <UploadFlow isSubscribed={isSubscribed} />
      <HistoryList analyses={history} />
    </main>
  );
}
