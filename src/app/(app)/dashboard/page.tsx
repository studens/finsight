import React from "react";

import { HistoryList } from "../../../components/HistoryList";
import { UploadFlow } from "../../../components/UploadFlow";
import {
  getSessionUser,
  getSubscriptionStatus,
  listUserAnalyses,
} from "../../../lib/supabase/server";

export default async function DashboardPage() {
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
      <UploadFlow isSubscribed={isSubscribed} />
      <HistoryList analyses={history} />
    </main>
  );
}
