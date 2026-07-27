import Link from "next/link";
import React from "react";

import { AiInsightDemo } from "../../components/AiInsightDemo";
import { Badge, Card, IconBadge } from "../../components/ui";

const primaryLinkClasses =
  "inline-flex h-14 items-center justify-center rounded-full bg-[#0052ff] px-8 font-semibold text-white transition-colors hover:bg-[#003ecc]";

const cardHoverClasses =
  "transition duration-200 hover:ring-1 hover:ring-[#33363c]";

const steps = [
  {
    icon: UploadIcon,
    title: "CSV 업로드",
    description: "카드사나 은행에서 받은 거래내역 CSV를 그대로 올리세요.",
  },
  {
    icon: ChecklistIcon,
    title: "컬럼 자동 매핑 확인",
    description: "자동으로 찾은 날짜, 가맹점, 금액 컬럼을 한 번 확인하세요.",
  },
  {
    icon: ChartIcon,
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
      <div className="mx-auto max-w-5xl space-y-24">
        <section className="pt-8 text-center sm:pt-12">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#16181c] px-4 py-2 text-[13px] font-medium text-[#a8acb3]">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#05b169]" />
            원본 CSV 미저장 · 뒤 4자리만
          </span>
          <h1 className="mt-6 break-keep text-4xl font-normal leading-[1.05] tracking-[-0.03em] text-white sm:text-6xl sm:leading-[1.02]">
            거래내역을 올리면,
            <br />
            새는 돈이 보여요.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#a8acb3]">
            카드·은행 CSV 하나로 지출 흐름을 정리하고, 놓치기 쉬운 금융
            인사이트를 확인하세요.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <Link className={primaryLinkClasses} href="/login">
              무료로 시작하기
            </Link>
            <p className="text-[13px] text-[#6e7480]">
              카드 등록 없이 · 이름·전화번호는 전송하지 않아요
            </p>
          </div>

          <HeroPreview />
        </section>

        <section aria-labelledby="how-it-works" className="space-y-8">
          <div>
            <p className="text-sm font-medium text-[#a8acb3]">작동 방식</p>
            <h2
              className="mt-2 text-3xl font-normal tracking-tight text-white sm:text-4xl"
              id="how-it-works"
            >
              세 단계면 충분해요
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-6 max-sm:grid-cols-1">
            {steps.map((step, index) => (
              <Card
                className={`animate-fade-in ${cardHoverClasses}`}
                key={step.title}
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <IconBadge tone="brand">
                  <step.icon />
                </IconBadge>
                <h3 className="mt-6 text-lg font-medium text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#a8acb3]">
                  {step.description}
                </p>
                {index === steps.length - 1 ? <RawToSummaryVisual /> : null}
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="ai-insight-demo" className="space-y-8">
          <div className="text-center">
            <p className="text-sm font-medium text-[#a8acb3]">실제 동작</p>
            <h2
              className="mt-2 text-3xl font-normal tracking-tight text-white sm:text-4xl"
              id="ai-insight-demo"
            >
              같은 명세서에서 AI가 무엇을 찾아내는지 보여줍니다
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-[#a8acb3]">
              원본 CSV는 그대로, 마스킹된 거래 단위만 AI에게 전달해 구독 누수·이상
              거래·카테고리 비중을 정리합니다.
            </p>
          </div>
          <AiInsightDemo />
        </section>

        <section aria-labelledby="plans" className="space-y-8">
          <div>
            <p className="text-sm font-medium text-[#a8acb3]">기능 비교</p>
            <h2
              className="mt-2 text-3xl font-normal tracking-tight text-white sm:text-4xl"
              id="plans"
            >
              필요한 만큼 깊게 확인하세요
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
            <Card className={`animate-fade-in ${cardHoverClasses}`}>
              <h3 className="text-sm font-medium tracking-[0.08em] text-[#a8acb3]">
                FREE
              </h3>
              <p className="mt-3 text-2xl font-normal text-white">무료·무제한</p>
              <p className="mt-2 text-sm text-[#6e7480]">
                올릴 때마다 바로 계산되는 기본 지출 요약
              </p>
              <FeatureList features={freeFeatures} tone="free" />
            </Card>
            <Card
              className={`relative animate-fade-in border-l-4 border-[#0052ff] ${cardHoverClasses}`}
              style={{ animationDelay: "80ms" }}
            >
              <Badge className="bg-[rgba(0,82,255,0.14)] text-[#5b8bff]">
                PREMIUM
              </Badge>
              <p className="mt-3 text-2xl font-normal text-white">구독</p>
              <p className="mt-2 text-sm text-[#6e7480]">
                이번 달, 카테고리별로 얼마나 늘었을까요?
              </p>
              <FeatureList features={premiumFeatures} tone="premium" />
            </Card>
          </div>
        </section>

        <section aria-labelledby="data-trust">
          <Card className={`animate-fade-in ${cardHoverClasses}`}>
            <div className="flex items-start gap-4">
              <IconBadge className="h-11 w-11" tone="hygiene">
                <ShieldIcon />
              </IconBadge>
              <div>
                <h2 className="text-xl font-medium text-white" id="data-trust">
                  금융 데이터는 필요한 만큼만 다뤄요
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#a8acb3]">
                  원본 CSV는 저장하지 않아요 — 분석에 필요한 마스킹된 요약만
                  남겨요. 카드/계좌번호는 뒤 4자리만, 이름·전화번호는 아예
                  전송하지 않아요.
                </p>
              </div>
            </div>
          </Card>
        </section>

        <section className="pb-8 text-left">
          <h2 className="text-3xl font-normal tracking-tight text-white sm:text-4xl">
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

const previewCategories = [
  { name: "식비", amount: "612,400", width: "100%" },
  { name: "구독", amount: "289,000", width: "47%" },
  { name: "교통", amount: "168,200", width: "27%" },
] as const;

function HeroPreview() {
  return (
    <div className="mx-auto mt-16 max-w-2xl animate-slide-up text-left">
      <div className="rounded-[24px] bg-[#16181c] p-6 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.8)] ring-1 ring-[#22252b] sm:p-8">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-[#a8acb3]">이번 달 지출 요약</p>
          <span className="rounded-full bg-[#0a0b0d] px-2.5 py-1 text-[11px] font-medium text-[#6e7480]">
            예시
          </span>
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-[#6e7480]">총 지출</p>
          <p className="mt-1 font-mono text-4xl font-medium tabular-nums text-white">
            2,418,300
            <span className="ml-1 text-2xl text-[#6e7480]">원</span>
          </p>
        </div>

        <div className="mt-6 space-y-4">
          {previewCategories.map((category) => (
            <div key={category.name}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-[#a8acb3]">{category.name}</span>
                <span className="font-mono tabular-nums text-white">
                  {category.amount}원
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#0a0b0d]">
                <div
                  className="h-full rounded-full bg-[#0052ff]"
                  style={{ width: category.width }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-2xl border-l-4 border-[#cf202f] bg-[#0a0b0d] p-4">
          <IconBadge tone="risk">
            <span aria-hidden="true" className="text-sm font-semibold">
              !
            </span>
          </IconBadge>
          <div>
            <p className="text-sm font-medium text-white">중복 구독 2건이 보여요</p>
            <p className="text-xs text-[#a8acb3]">매달 24,800원이 새고 있어요</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const featureToneClasses = {
  free: "bg-[rgba(5,177,105,0.14)] text-[#05b169]",
  premium: "bg-[rgba(0,82,255,0.16)] text-[#5b8bff]",
} as const;

function FeatureList({
  features,
  tone,
}: {
  features: readonly string[];
  tone: keyof typeof featureToneClasses;
}) {
  return (
    <ul className="mt-8 space-y-4">
      {features.map((feature) => (
        <li className="flex items-center gap-3 text-sm text-white" key={feature}>
          <span
            aria-hidden="true"
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${featureToneClasses[tone]}`}
          >
            <CheckIcon />
          </span>
          {feature}
        </li>
      ))}
    </ul>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      viewBox="0 0 12 12"
      width="12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 6.2 5 8.7l4.5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function RawToSummaryVisual() {
  return (
    <div className="mt-6 flex items-center gap-2" aria-hidden="true">
      <div className="min-w-0 flex-1 rounded-xl bg-[#0a0b0d] p-3">
        <p className="truncate font-mono text-[11px] leading-relaxed text-[#6e7480]">
          07-02,스타벅스,-4,500
          <br />
          07-03,넷플릭스,-13,500
          <br />
          07-05,GS25,-8,200
        </p>
      </div>
      <ArrowRightIcon className="shrink-0 text-[#33363c]" />
      <div className="flex-1 rounded-xl bg-[#0a0b0d] p-3">
        <p className="text-[11px] text-[#a8acb3]">식비 합계</p>
        <p className="font-mono text-base font-medium tabular-nums text-white">
          612,400원
        </p>
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 13V4m0 0-3.5 3.5M10 4l3.5 3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M4.5 13.5V15a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 5.5h7.5M8 10h7.5M8 14.5h4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="m4 5.3 1 1L7 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="m4 9.8 1 1 2-2.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4.5 16V10M10 16V4M15.5 16v-6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ArrowRightIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 8h9M8 4.5 11.5 8 8 11.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 2.5 4 5v4.5c0 3.4 2.4 6.3 6 7.5 3.6-1.2 6-4.1 6-7.5V5l-6-2.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="m7.6 9.8 1.7 1.7 3.1-3.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
