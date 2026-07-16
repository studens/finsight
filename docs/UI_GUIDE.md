# UI 디자인 가이드

## 디자인 원칙
1. 도구처럼 보여야 한다 — 마케팅 페이지가 아니라 매일 여는 가계부 대시보드.
2. 숫자와 표가 주인공이다 — 장식은 숫자를 가리지 않는다.
3. 무료/유료 경계를 숨기지 않는다 — 잠긴 기능은 잠긴 채로 명확히 보여주고, 블러로 얼버무리지 않는다.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |
| 페이월에 backdrop-filter: blur() 사용 | 위 금지 사항과 동일한 이유 — 잠금 아이콘 + 반투명 오버레이로 대체 |

## 색상
### 배경
| 용도 | 값 |
|------|------|
| 페이지 | #0a0a0a |
| 카드 | #141414 |

### 텍스트
| 용도 | 값 |
|------|------|
| 주 텍스트 | text-white |
| 본문 | text-neutral-300 |
| 보조 | text-neutral-400 |
| 비활성 | text-neutral-500 |

### 데이터/시맨틱 색상
| 용도 | 값 |
|------|------|
| 긍정/성공 (수입, 정상) | #22c55e |
| 부정/에러 (지출 급증, 이상거래) | #ef4444 |
| 중립/기본 | #525252 |
| 액센트 (CTA, Pro 배지, "무제한" 강조) | #d97706 (딥 앰버 — 보라/인디고 회피, 긍정/부정 시맨틱 색과 겹치지 않도록 금색 계열로 분리) |

## 컴포넌트
### 카드
```
rounded-lg bg-[#141414] border border-neutral-800 p-6
```

### 버튼
```
Primary: rounded-lg bg-white text-black hover:bg-neutral-200
Accent (업그레이드 CTA): rounded-lg bg-[#d97706] text-black hover:bg-[#b45309]
Text:    text-neutral-500 hover:text-neutral-300
```

### 입력 필드
```
rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3
```

### 무료 배지 ("무제한")
```
inline-flex items-center rounded-md border border-neutral-800 px-2 py-0.5 text-xs text-neutral-300
```

### 페이월 잠금 UI (블러 금지 — 잠금 아이콘 + 반투명 오버레이로 대체)
```
카드 컨테이너: relative rounded-lg bg-[#141414] border border-neutral-800 p-6
오버레이: absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0a0a]/80
잠금 아이콘: 인라인 SVG lock, strokeWidth 1.5, text-neutral-500
CTA 텍스트: text-sm text-neutral-300 + Accent 버튼("업그레이드")
```

### 에러/페이월 모달 (403/404/502 공통)
API가 상태 코드·`code`를 반환해도 화면엔 절대 그대로 노출하지 않는다. `PAYWALL_REQUIRED`/`NOT_FOUND`/`GENERATION_FAILED` 모두 아래 스타일의 모달로 부드러운 문구를 보여주고, 페이지 이동 없이 현재 화면 위에 뜬다.
```
오버레이: fixed inset-0 bg-black/60 flex items-center justify-center (blur 없음, 단색 반투명만)
모달 박스: rounded-lg bg-[#141414] border border-neutral-800 p-6 max-w-sm
문구: text-sm text-neutral-300
버튼: 위 버튼 스타일(Primary/Accent/Text) 재사용, "닫기"는 Text, "업그레이드"/"다시 시도"는 Accent
```
문구는 항상 자연어로("PAYWALL_REQUIRED", "403" 같은 코드/영단어를 그대로 쓰지 않는다). 예: "이 리포트는 Pro 플랜에서 볼 수 있어요.", "요청하신 내용을 찾을 수 없어요. 새로고침 후 다시 시도해주세요.", "리포트를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요."

## 레이아웃
- 전체 너비: max-w-5xl
- 정렬: 좌측 정렬 기본. 중앙 정렬 금지
- 간격: gap-3~4, 섹션 간 space-y-8

## 타이포그래피
| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | text-4xl font-semibold text-white |
| 카드 제목 | text-sm font-medium text-neutral-400 |
| 본문 | text-sm text-neutral-300 leading-relaxed |
| 숫자/금액 강조 | text-2xl font-semibold tabular-nums |

## 애니메이션
- fade-in (0.4s) — 리포트/카드 최초 표시
- slide-up (0.5s) — 대시보드 섹션 진입
- 리포트 지연 생성 중 로딩 스피너 (회전만, glow/pulse 금지)
- 그 외 모든 애니메이션 금지 (글로우, 그라데이션 애니메이션, 파티클 등)

## 아이콘
- SVG 인라인, strokeWidth 1.5
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다
