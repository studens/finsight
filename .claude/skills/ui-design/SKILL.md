---
name: ui-design
description: finsight 앱의 UI 디자인 가이드 — 색상 토큰, 타이포그래피, 컴포넌트 스타일(카드/배지/버튼/입력 필드/대화형 말풍선), 레이아웃, 애니메이션, 아이콘 규칙과 금지된 "AI 슬롭" 안티패턴(glass morphism, gradient-text, 보라색 브랜딩 등)을 담고 있다. React/TSX 컴포넌트를 새로 만들거나, Tailwind 클래스로 스타일링하거나, 색상/폰트/여백/반경을 정하거나, 랜딩·대시보드·모달 등 화면 UI를 다룰 때 반드시 먼저 로드한다.
---

# UI 디자인 가이드

## 디자인 원칙
1. 도구처럼 보여야 한다 — 마케팅 페이지가 아니라 매일 확인하는 대시보드처럼, 데이터 자체가 주인공이 된다.
2. 신뢰감이 우선이다 — 카드 명세서라는 민감한 데이터를 다루는 화면이므로, 화려한 장식보다 명료함과 안정감을 준다.
3. 절제된 대비 — 색상은 정보 전달(양수/음수, Risk/Opportunity/Hygiene 구분, Free/Premium 구분)에만 사용하고 장식 목적으로 쓰지 않는다.

이 가이드의 컬러/타이포/컴포넌트 토큰은 `public/deck/`의 Sightline 데모덱 시각 언어를 기준으로 삼는다. 다만 앱은 **다크모드 고정**이므로, 데크의 라이트 섹션(Problem/Overview/Impact/Security 슬라이드의 흰색·연회색 배경)은 가져오지 않는다.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 (정적인 elevation shadow는 허용) |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 |
| 컴포넌트 역할 구분 없이 전부 같은 반경 | 카드(24px)/리스트 아이템(16px)/배지·버튼(pill)처럼 역할별로 반경을 다르게 쓴다. 역할이 다른데도 전부 rounded-2xl이면 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |

## 폰트
- 본문/제목: **Inter** (400, 500, 600, 700)
- 수치/코드: **JetBrains Mono** (400, 500, 600), `font-variant-numeric: tabular-nums`

## 색상
### 배경 (다크, 3단 표면)
| 용도 | 값 |
|------|------|
| 페이지 | #0a0b0d |
| 카드/패널 | #16181c |
| 패널 내부 리스트 아이템(중첩 표면) | #0a0b0d |

### 텍스트
| 용도 | 값 |
|------|------|
| 주 텍스트 | #ffffff |
| 본문/보조 | #a8acb3 |
| 비활성 | #6e7480 |

### 시맨틱/브랜드 컬러
| 용도 | 값 |
|------|------|
| 포인트(브랜드/Primary CTA) | #0052ff · hover #003ecc |
| 긍정/기회(Opportunity) | #05b169 |
| 부정/위험(Risk)·경고 | #cf202f |
| 정보/위생(Hygiene) 강조 | #5b8bff |
| 테두리/구분선(다크) | #33363c |

## 컴포넌트
### 배지 (eyebrow / 라벨 pill)
```
inline-flex px-4 py-2 rounded-full bg-[#16181c] text-[13px] font-semibold tracking-[0.08em] text-[#a8acb3]
```
"LIVE", "PREMIUM" 같은 짧은 대문자 라벨에 사용.

### 카드/패널
```
rounded-[24px] bg-[#16181c] p-8
```
다크 표면끼리는 border 없이 배경색 차이만으로 구분한다(라이트 섹션 전용인 `border border-[#dee1e6]`는 다크 앱에 가져오지 않음).

### 리스트 아이템 (인사이트 피드형 — Free/Premium 인사이트 카드에 적용)
```
rounded-2xl bg-[#0a0b0d] p-5 flex gap-4 items-start
아이콘 배지: w-9 h-9 rounded-full, 배경 = 시맨틱 컬러 15% 투명도(rgba), 아이콘 색 = 그 시맨틱 컬러
선택: border-l-4 border-[색]로 좌측 강조 (Risk=#cf202f, Opportunity=#05b169, Hygiene=#5b8bff)
```

### 버튼
```
Primary: h-14 px-8 rounded-full bg-[#0052ff] text-white hover:bg-[#003ecc] font-semibold
Secondary: h-14 px-8 rounded-full bg-transparent border border-[#33363c] text-white font-semibold
Text: text-[#a8acb3] hover:text-white
```

### 입력 필드
```
rounded-xl bg-[#16181c] border border-[#2a2d33] px-4 py-3 text-white
```

### 대화형 컴포넌트 (질의응답형 기능에 사용 — 예: 추후 "이 지출에 대해 물어보기")
```
사용자 말풍선: 우측 정렬, bg-[#0052ff] text-white, rounded-[20px] (우하단만 4px)
응답 말풍선: 좌측 정렬, bg-[#16181c], rounded-[20px] (좌하단만 4px)
근거 수치 블록(응답 내부): bg-[#0a0b0d] rounded-xl p-4, 라벨-값 좌우 정렬, 값은 font-mono + 시맨틱 컬러
```

### Premium 잠금 카드
```
Premium 리포트는 Free 사용자에 대해 서버에서 생성 자체를 하지 않으므로(지연 생성), 블러 처리할 실제 값이 없다.
카드(rounded-[24px] bg-[#16181c]) 내부: 리포트 이름 + 한 줄 설명(예: "전월 대비 지출 변화를 확인하세요") + text-[#a8acb3]
중앙/하단에 Primary 버튼("Premium으로 보기")
(backdrop-filter: blur() 금지 — 실제 데이터를 흐리게 보여주는 대신, 빈 상태 + CTA로만 구성한다)
```

## 레이아웃
- 앱 콘텐츠 전체 너비: max-w-5xl
- 정렬: 좌측 정렬 기본. 중앙 정렬 금지 (랜딩 히어로 제외)
- 간격: gap-3~4, 섹션 간 space-y-8
- 통계/피처 그리드: grid-cols-3 gap-6 (데크의 3열 스탯 그리드 패턴)

## 타이포그래피
| 용도 | 스타일 |
|------|--------|
| 히어로/디스플레이 제목 ("disp") | font-normal tracking-[-0.03em] leading-[1.02] text-white, text-5xl~6xl |
| 섹션 제목 | font-normal tracking-tight text-white, text-3xl~4xl |
| 카드 제목 | text-sm font-medium text-[#a8acb3] |
| 본문 | text-sm text-[#a8acb3] leading-relaxed |
| 강조 수치(지출 합계 등) | font-mono tabular-nums font-medium text-3xl~5xl text-white, 양수/음수는 시맨틱 컬러 |

## 애니메이션
- fade-in (0.4s) — 카드/섹션 등장
- slide-up (0.5s) — 업로드 완료 후 결과 카드 전환
- 그 외 모든 애니메이션(글로우, 바운스, 무한 반복 등) 금지

## 아이콘
- 심플한 기하학적 글리프(원, 화살표, 느낌표 등) 또는 strokeWidth 1.5 SVG
- **원형 배지로 감싸는 것이 기본형**: w-9~12 h-9~12 rounded-full, 배경은 해당 아이콘의 시맨틱 컬러 15% 투명도, 아이콘 색은 그 컬러 그대로
