import Link from "next/link";
import React from "react";

export interface HistoryAnalysis {
  id: string;
  createdAt: string;
  totalSpent: number;
  transactionCount: number;
}

export interface HistoryListProps {
  analyses: HistoryAnalysis[];
}

const numberFormatter = new Intl.NumberFormat("ko-KR");
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Seoul",
});

export function HistoryList({ analyses }: HistoryListProps) {
  return (
    <section aria-labelledby="history-heading" className="rounded-[24px] bg-[#16181c] p-8">
      <h2 id="history-heading" className="text-xl font-semibold text-white">
        업로드 이력
      </h2>

      {analyses.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-[#0a0b0d] p-5 text-sm text-[#a8acb3]">
          아직 업로드한 내역이 없어요 — CSV를 올려 시작해 보세요
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {analyses.map((analysis) => (
            <li key={analysis.id}>
              <Link
                className="flex items-start gap-4 rounded-2xl bg-[#0a0b0d] p-5 transition-colors hover:bg-[#202329]"
                href={`/dashboard/${analysis.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[#a8acb3]">
                    {dateFormatter.format(new Date(analysis.createdAt))}
                  </p>
                  <p className="mt-2 font-mono text-lg tabular-nums text-white">
                    {numberFormatter.format(analysis.totalSpent)}원
                  </p>
                </div>
                <span className="font-mono text-sm tabular-nums text-[#a8acb3]">
                  {numberFormatter.format(analysis.transactionCount)}건
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
