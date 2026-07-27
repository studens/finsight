"use client";

import React, { useState } from "react";

import { IconBadge } from "./ui";

const rawRows = [
  { date: "04-07", merchant: "YouTube Premium", amount: "14,900", card: "****-****-3456" },
  { date: "04-08", merchant: "스타벅스 강남점", amount: "5,800", card: "****-****-3456" },
  { date: "04-09", merchant: "지하철 2호선", amount: "1,550", card: "****-****-3456" },
  { date: "04-10", merchant: "쿠팡", amount: "68,500", card: "****-****-3456" },
] as const;

const insightTabs = [
  {
    key: "subscription",
    label: "구독 누수",
    category: "구독",
    count: "2건",
    amount: "24,800",
    description: "매달 반복되는 소액 구독료가 쌓이고 있어요. 이번 달 중복 구독 2건을 찾았어요.",
  },
  {
    key: "anomaly",
    label: "이상 거래",
    category: "이상 거래",
    count: "1건",
    amount: "185,000",
    description: "평소보다 큰 금액의 일회성 결제가 있었어요. 본인 결제가 맞는지 확인해보세요.",
  },
  {
    key: "category",
    label: "카테고리 톱",
    category: "기타",
    count: "1건",
    amount: "780,000",
    description: "샘플 명세서에서는 6월 전자제품 지출과 월간 반복 결제가 지출 변동의 핵심입니다.",
  },
] as const;

type InsightKey = (typeof insightTabs)[number]["key"];

export function AiInsightDemo() {
  const [activeKey, setActiveKey] = useState<InsightKey>("category");
  const active = insightTabs.find((tab) => tab.key === activeKey) ?? insightTabs[2];

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 max-sm:grid-cols-1">
      <div className="rounded-[24px] bg-[#16181c] p-6">
        <p className="font-mono text-xs text-[#6e7480]">raw_statement.csv</p>
        <div className="mt-4">
          <div className="grid grid-cols-[4rem_1fr_4.5rem_6.5rem] gap-2 px-2 text-[11px] font-medium text-[#6e7480] max-sm:grid-cols-[1fr_4.5rem_6.5rem]">
            <span className="max-sm:hidden">날짜</span>
            <span>가맹점</span>
            <span>금액</span>
            <span>카드번호</span>
          </div>
          {rawRows.map((row, index) => (
            <div
              className={`grid grid-cols-[4rem_1fr_4.5rem_6.5rem] gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] text-[#a8acb3] max-sm:grid-cols-[1fr_4.5rem_6.5rem] ${
                index % 2 === 0 ? "bg-[#0a0b0d]" : ""
              } ${index === rawRows.length - 1 ? "opacity-40" : ""}`}
              key={row.merchant}
            >
              <span className="max-sm:hidden">{row.date}</span>
              <span className="truncate">{row.merchant}</span>
              <span>{row.amount}</span>
              <span>{row.card}</span>
            </div>
          ))}
        </div>
      </div>

      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center justify-self-center rounded-full bg-[#16181c] text-[#6e7480] ring-1 ring-[#33363c]"
      >
        <ArrowDownIcon />
      </span>

      <div className="rounded-[24px] bg-[#16181c] p-6 ring-1 ring-[#0052ff]/25">
        <div className="flex items-center gap-2">
          <IconBadge className="h-7 w-7" tone="brand">
            <SparkleIcon />
          </IconBadge>
          <p className="text-sm font-medium text-white">AI가 정리한 인사이트</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {insightTabs.map((tab) => (
            <button
              className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                tab.key === activeKey
                  ? "bg-[#0052ff] text-white"
                  : "bg-[#0a0b0d] text-[#a8acb3] hover:text-white"
              }`}
              key={tab.key}
              onClick={() => setActiveKey(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="mt-6 text-xs font-medium text-[#6e7480]">
          {active.category} · {active.count}
        </p>
        <p className="mt-1 font-mono text-4xl font-medium tabular-nums text-[#5b8bff]">
          {active.amount}
          <span className="ml-1 text-2xl text-[#6e7480]">원</span>
        </p>
        <p className="mt-4 text-sm leading-relaxed text-[#a8acb3]">{active.description}</p>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 1.5c.3 2.2 1 3.7 2 4.7s2.5 1.7 4.7 2c-2.2.3-3.7 1-4.7 2s-1.7 2.5-2 4.7c-.3-2.2-1-3.7-2-4.7s-2.5-1.7-4.7-2c2.2-.3 3.7-1 4.7-2s1.7-2.5 2-4.7Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 2.5v9M4.5 8 8 11.5 11.5 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
