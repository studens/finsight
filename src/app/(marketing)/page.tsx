import Link from "next/link";
import React from "react";

import { Badge, Card, IconBadge } from "../../components/ui";

const primaryLinkClasses =
  "inline-flex h-14 items-center justify-center rounded-full bg-[#0052ff] px-8 font-semibold text-white hover:bg-[#003ecc]";

const steps = [
  {
    number: "1",
    title: "CSV 업로드",
    description: "카드사나 은행에서 받은 거래내역 CSV를 그대로 올리세요.",
  },
  {
    number: "2",
    title: "컬럼 자동 매핑 확인",
    description: "자동으로 찾은 날짜, 가맹점, 금액 컬럼을 한 번 확인하세요.",
  },
  {
    number: "3",
    title: "인사이트 확인",
    description: "복잡한 거래내역을 이해하기 쉬운 지출 요약으로 확인하세요.",
  },
] as const;

const freeFeatures = [
  "카테고리별 합계",
  "총 지출·거래 건수",
  "가맹점 Top 5",
] as const;

const premiumFeatures = [
  "전월 대비 증감",
  "이상 거래·중복구독 탐지",
  "절약 제안",
  "카테고리별 예산 추천",
] as const;

export default function MarketingPage() {
  return (
    <main className="min-h-screen bg-[#0a0b0d] px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-5xl space-y-8">
        <section className="py-12 text-center sm:py-20">
          <h1 className="text-5xl font-normal leading-[1.02] tracking-[-0.03em] text-white sm:text-6xl">
            거래내역을 올리면,
            <br />
            새는 돈이 보여요.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#a8acb3]">
            카드·은행 CSV 하나로 지출 흐름을 정리하고, 놓치기 쉬운 금융
            인사이트를 확인하세요.
          </p>
          <Link className={`${primaryLinkClasses} mt-8`} href="/login">
            무료로 시작하기
          </Link>
        </section>

        <section aria-labelledby="how-it-works" className="space-y-6">
          <div>
            <p className="text-sm font-medium text-[#a8acb3]">작동 방식</p>
            <h2
              className="mt-2 text-3xl font-normal tracking-tight text-white"
              id="how-it-works"
            >
              세 단계면 충분해요
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-6">
            {steps.map((step) => (
              <Card className="animate-fade-in" key={step.number}>
                <IconBadge tone="brand">{step.number}</IconBadge>
                <h3 className="mt-6 text-lg font-medium text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#a8acb3]">
                  {step.description}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="plans" className="space-y-6 pt-8">
          <div>
            <p className="text-sm font-medium text-[#a8acb3]">기능 비교</p>
            <h2
              className="mt-2 text-3xl font-normal tracking-tight text-white"
              id="plans"
            >
              필요한 만큼 깊게 확인하세요
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <Card className="animate-fade-in">
              <h3 className="text-sm font-medium tracking-[0.08em] text-[#a8acb3]">
                FREE
              </h3>
              <p className="mt-3 text-2xl font-normal text-white">무료·무제한</p>
              <FeatureList features={freeFeatures} />
            </Card>
            <Card className="animate-fade-in">
              <Badge>PREMIUM</Badge>
              <p className="mt-3 text-2xl font-normal text-white">구독</p>
              <FeatureList features={premiumFeatures} />
            </Card>
          </div>
        </section>

        <section className="pt-8" aria-labelledby="data-trust">
          <Card className="animate-fade-in">
            <h2 className="text-xl font-medium text-white" id="data-trust">
              금융 데이터는 필요한 만큼만 다뤄요
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[#a8acb3]">
              원본 CSV는 저장하지 않아요 — 분석에 필요한 마스킹된 요약만
              남겨요. 카드/계좌번호는 뒤 4자리만, 이름·전화번호는 아예 전송하지
              않아요.
            </p>
          </Card>
        </section>

        <section className="py-16 text-left">
          <h2 className="text-3xl font-normal tracking-tight text-white">
            내 지출을 더 선명하게 보세요.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[#a8acb3]">
            CSV를 준비했다면 바로 시작할 수 있어요.
          </p>
          <Link className={`${primaryLinkClasses} mt-8`} href="/login">
            무료로 시작하기
          </Link>
        </section>
      </div>
    </main>
  );
}

function FeatureList({ features }: { features: readonly string[] }) {
  return (
    <ul className="mt-8 space-y-4">
      {features.map((feature) => (
        <li className="flex items-center gap-3 text-sm text-[#a8acb3]" key={feature}>
          <span aria-hidden="true" className="text-[#0052ff]">
            ●
          </span>
          {feature}
        </li>
      ))}
    </ul>
  );
}
