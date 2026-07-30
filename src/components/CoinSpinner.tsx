import React from "react";

interface CoinSpinnerProps {
  /** 진행 상황을 설명하는 문구. 스크린리더에 읽힌다. */
  label: string;
}

/**
 * 파일을 읽는 동안 보여주는 로딩 표시. 동전이 도는 모양이다.
 *
 * 동전 자체는 aria-hidden으로 감추고 문구만 role="status"로 알린다.
 * 회전은 prefers-reduced-motion에서 globals.css가 꺼준다.
 */
export function CoinSpinner({ label }: CoinSpinnerProps) {
  return (
    <div className="mt-4 flex items-center gap-3" role="status">
      <span
        aria-hidden="true"
        className="inline-flex h-9 w-9 animate-coin-flip items-center justify-center rounded-full bg-[rgba(0,82,255,0.15)] text-sm font-semibold text-[#0052ff]"
      >
        ₩
      </span>
      <span className="text-sm text-[#a8acb3]">{label}</span>
    </div>
  );
}
