"use client";

import React, { useState } from "react";

import { useApiError } from "../hooks/useApiError";
import type { PremiumReport, ReportType, SpendingChange } from "../types/pipeline";
import { ErrorModal } from "./ErrorModal";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export interface PremiumSectionProps {
  analysisId: string;
  isSubscribed: boolean;
}

interface ReportMeta {
  type: ReportType;
  title: string;
  description: string;
}

const REPORTS: ReportMeta[] = [
  {
    type: "mom_comparison",
    title: "전월 대비 지출 변화",
    description: "전월 대비 지출 변화를 확인하세요",
  },
  {
    type: "anomaly_detection",
    title: "이상 거래·중복구독 탐지",
    description: "평소와 다른 거래와 중복 구독을 확인하세요",
  },
  {
    type: "savings_suggestions",
    title: "절약 제안",
    description: "지출에서 실천 가능한 절약 기회를 찾아보세요",
  },
  {
    type: "budget_recommendation",
    title: "카테고리별 예산 추천",
    description: "지출 패턴에 맞는 카테고리별 예산을 확인하세요",
  },
];

const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function Amount({ value }: { value: number }) {
  return <span className="font-mono tabular-nums">{won.format(value)}</span>;
}

function ChangeDetails({ change }: { change: SpendingChange }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#a8acb3]">
      <span>
        현재 <Amount value={change.current} />
      </span>
      <span>
        이전 <Amount value={change.previous} />
      </span>
      <span className="font-mono tabular-nums text-[#5b8bff]">
        {change.change >= 0 ? "+" : ""}
        {won.format(change.change)}
        {change.changeRate === null ? "" : ` (${change.changeRate}%)`}
      </span>
    </div>
  );
}

function ReportData({ report }: { report: PremiumReport }) {
  switch (report.type) {
    case "mom_comparison":
      return (
        <div className="mt-6 animate-fade-in">
          {report.commentary ? (
            <p className="mb-4 text-sm leading-relaxed text-[#a8acb3]">
              {report.commentary}
            </p>
          ) : null}
          {!report.hasPrevious ? (
            <p className="rounded-2xl bg-[#0a0b0d] p-5 text-sm text-[#a8acb3]">
              비교할 이전 분석이 아직 없어요.
            </p>
          ) : (
            <ul aria-label="전월 대비 상세" className="space-y-3">
              {report.total ? (
                <li className="rounded-2xl border-l-4 border-[#5b8bff] bg-[#0a0b0d] p-5">
                  <p className="font-medium text-white">전체 지출</p>
                  <ChangeDetails change={report.total} />
                </li>
              ) : null}
              {report.categories.map((category) => (
                <li
                  key={category.category}
                  className="rounded-2xl border-l-4 border-[#5b8bff] bg-[#0a0b0d] p-5"
                >
                  <p className="font-medium text-white">{category.category}</p>
                  <ChangeDetails change={category} />
                </li>
              ))}
            </ul>
          )}
        </div>
      );

    case "anomaly_detection":
      return (
        <div className="mt-6 animate-fade-in">
          <p className="mb-4 text-sm leading-relaxed text-[#a8acb3]">{report.summary}</p>
          <ul aria-label="이상 거래 상세" className="space-y-3">
            {report.anomalies.map((anomaly) => (
              <li
                key={`${anomaly.transactionIndex}-${anomaly.reason}`}
                className="rounded-2xl border-l-4 border-[#cf202f] bg-[#0a0b0d] p-5"
              >
                <p className="text-sm text-white">{anomaly.reason}</p>
                <p className="mt-2 font-mono text-xs uppercase tabular-nums text-[#cf202f]">
                  {anomaly.severity}
                </p>
              </li>
            ))}
          </ul>
        </div>
      );

    case "savings_suggestions":
      return (
        <div className="mt-6 animate-fade-in">
          <p className="mb-4 text-sm leading-relaxed text-[#a8acb3]">{report.summary}</p>
          <ul aria-label="절약 제안 상세" className="space-y-3">
            {report.suggestions.map((suggestion) => (
              <li
                key={suggestion.title}
                className="rounded-2xl border-l-4 border-[#05b169] bg-[#0a0b0d] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="font-medium text-white">{suggestion.title}</p>
                  <span className="font-mono tabular-nums text-[#05b169]">
                    {won.format(suggestion.estimatedMonthlySavings)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#a8acb3]">
                  {suggestion.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      );

    case "budget_recommendation":
      return (
        <div className="mt-6 animate-fade-in">
          <p className="mb-4 text-sm leading-relaxed text-[#a8acb3]">{report.summary}</p>
          <ul aria-label="예산 추천 상세" className="space-y-3">
            {report.categories.map((category) => (
              <li
                key={category.category}
                className="rounded-2xl border-l-4 border-[#5b8bff] bg-[#0a0b0d] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="font-medium text-white">{category.category}</p>
                  <span className="font-mono tabular-nums text-[#5b8bff]">
                    {won.format(category.recommendedBudget)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#a8acb3]">
                  현재 지출 <Amount value={category.currentSpending} />
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#a8acb3]">
                  {category.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

export function PremiumSection({ analysisId, isSubscribed }: PremiumSectionProps) {
  const [reports, setReports] = useState<Partial<Record<ReportType, PremiumReport>>>({});
  const [loading, setLoading] = useState<ReportType | null>(null);
  const { error, isOpen, handleResponse, close } = useApiError();

  async function loadReport(reportType: ReportType) {
    if (!isSubscribed || loading === reportType || reports[reportType]) {
      return;
    }

    setLoading(reportType);
    try {
      const response = await fetch(`/api/reports/${analysisId}/${reportType}`);
      if (await handleResponse(response)) {
        return;
      }

      const result = (await response.json()) as {
        reportType: ReportType;
        data: PremiumReport;
      };
      setReports((current) => ({ ...current, [reportType]: result.data }));
    } catch {
      await handleResponse(new Response("", { status: 500 }));
    } finally {
      setLoading(null);
    }
  }

  return (
    <section aria-label="Premium 리포트" className="grid gap-6 md:grid-cols-2">
      {REPORTS.map((report) => {
        const data = reports[report.type];
        const isLoading = loading === report.type;

        return (
          <article
            key={report.type}
            className="rounded-[24px] bg-[#16181c] p-8"
            data-testid={`premium-card-${report.type}`}
          >
            <Badge>PREMIUM</Badge>
            <h3 className="mt-5 text-xl font-semibold text-white">{report.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#a8acb3]">
              {report.description}
            </p>

            {isSubscribed ? (
              <>
                {!data ? (
                  <Button
                    aria-label={`${report.title} 조회`}
                    className="mt-6"
                    disabled={isLoading}
                    onClick={() => void loadReport(report.type)}
                    type="button"
                  >
                    {isLoading ? "불러오는 중..." : "리포트 보기"}
                  </Button>
                ) : null}
                {data ? <ReportData report={data} /> : null}
              </>
            ) : (
              <Button className="mt-6" type="button">
                Premium으로 보기
              </Button>
            )}
          </article>
        );
      })}

      <ErrorModal isOpen={isOpen} message={error?.message} onClose={close} />
    </section>
  );
}
