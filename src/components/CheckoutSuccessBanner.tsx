"use client";

import React, { useEffect } from "react";

export interface CheckoutSuccessBannerProps {
  isSubscribed: boolean;
}

export function CheckoutSuccessBanner({ isSubscribed }: CheckoutSuccessBannerProps) {
  useEffect(() => {
    window.history.replaceState(null, "", "/dashboard");
  }, []);

  return (
    <section
      className={`rounded-[24px] border-l-4 bg-[#16181c] p-8 ${
        isSubscribed ? "border-[#05b169]" : "border-[#5b8bff]"
      }`}
      data-testid="checkout-success-banner"
      role="status"
    >
      <h2 className="text-xl font-semibold text-white">결제가 완료됐어요</h2>
      <p className="mt-3 text-sm leading-relaxed text-[#a8acb3]">
        {isSubscribed
          ? "아래 업로드 이력에서 분석을 열면 Premium 리포트를 확인할 수 있어요."
          : "구독 반영까지 몇 초 걸릴 수 있어요. Premium 리포트가 아직 잠겨 있다면 잠시 후 페이지를 새로고침해 주세요."}
      </p>
    </section>
  );
}
