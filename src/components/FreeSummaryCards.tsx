import React from "react";

import type { FreeSummary } from "../types/pipeline";
import { Card, IconBadge } from "./ui";

export interface FreeSummaryCardsProps {
  summary: FreeSummary;
}

const amountFormatter = new Intl.NumberFormat("ko-KR");

function formatWon(amount: number) {
  return `${amountFormatter.format(amount)}원`;
}

export function FreeSummaryCards({ summary }: FreeSummaryCardsProps) {
  const sortedCategories = Object.entries(summary.categoryTotals).sort(
    ([, leftAmount], [, rightAmount]) => rightAmount - leftAmount,
  );

  return (
    <section
      aria-label="무료 지출 요약"
      className="slide-up max-w-5xl space-y-8 text-left"
    >
      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <h2 className="text-sm font-medium text-[#a8acb3]">총 지출</h2>
          <p className="mt-4 font-mono text-5xl font-medium tabular-nums text-white">
            {formatWon(summary.totalSpent)}
          </p>
        </Card>

        <Card>
          <h2 className="text-sm font-medium text-[#a8acb3]">거래 건수</h2>
          <p className="mt-4 font-mono text-3xl font-medium tabular-nums text-white">
            {amountFormatter.format(summary.transactionCount)}건
          </p>
        </Card>
      </div>

      <Card data-testid="category-card">
        <h2 className="text-sm font-medium text-[#a8acb3]">카테고리별 합계</h2>
        <ul aria-label="카테고리별 합계" className="mt-5 space-y-3">
          {sortedCategories.map(([category, amount]) => (
            <li
              className="flex items-start justify-between gap-4 rounded-2xl bg-[#0a0b0d] p-5"
              key={category}
            >
              <span className="text-sm text-white">{category}</span>
              <span className="font-mono text-sm tabular-nums text-white">
                {formatWon(amount)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-sm font-medium text-[#a8acb3]">가맹점 Top 5</h2>
        <ul aria-label="가맹점 Top 5" className="mt-5 space-y-3">
          {summary.topMerchants.map(({ merchant, amount }, index) => (
            <li
              className="flex items-start gap-4 rounded-2xl bg-[#0a0b0d] p-5"
              key={`${merchant}-${index}`}
            >
              <IconBadge aria-hidden="true" tone="hygiene">
                <span className="font-mono text-xs font-medium">{index + 1}</span>
              </IconBadge>
              <span className="min-w-0 flex-1 text-sm text-white">{merchant}</span>
              <span className="font-mono text-sm tabular-nums text-white">
                {formatWon(amount)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
