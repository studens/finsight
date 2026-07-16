# UI 디자인 가이드

## 디자인 원칙
1. 도구처럼 보여야 한다 — 마케팅 페이지가 아니라 매일 확인하는 대시보드처럼, 데이터 자체가 주인공이 된다.
2. 신뢰감이 우선이다 — 카드 명세서라는 민감한 데이터를 다루는 화면이므로, 화려한 장식보다 명료함과 안정감을 준다.
3. 절제된 대비 — 색상은 정보 전달(양수/음수, Free/Premium 구분)에만 사용하고 장식 목적으로 쓰지 않는다.

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
| 포인트(액션/Premium 강조) | #10b981 (emerald-500) |
| 긍정/증가 | #22c55e |
| 부정/감소·경고 | #ef4444 |
| 중립/기본 | #525252 |

## 컴포넌트
### 카드
```
rounded-lg bg-[#141414] border border-neutral-800 p-6
```

### 버튼
```
Primary: rounded-lg bg-white text-black hover:bg-neutral-200
Accent (Upgrade CTA): rounded-lg bg-emerald-500 text-black hover:bg-emerald-400
Text:    text-neutral-500 hover:text-neutral-300
```

### 입력 필드
```
rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3
```

### Premium 잠금 카드
```
Premium 리포트는 Free 사용자에 대해 서버에서 생성 자체를 하지 않으므로(지연 생성), 블러 처리할 실제 값이 없다.
카드 내부: 리포트 이름 + 한 줄 설명(예: "전월 대비 지출 변화를 확인하세요") + text-neutral-500
중앙/하단에 Accent 버튼("Premium으로 보기")
(backdrop-filter: blur() 금지 — 실제 데이터를 흐리게 보여주는 대신, 빈 상태 + CTA로만 구성한다)
```

## 레이아웃
- 전체 너비: max-w-5xl
- 정렬: 좌측 정렬 기본. 중앙 정렬 금지 (랜딩 히어로 제외)
- 간격: gap-3~4, 섹션 간 space-y-8

## 타이포그래피
| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | text-4xl font-semibold text-white |
| 카드 제목 | text-sm font-medium text-neutral-400 |
| 본문 | text-sm text-neutral-300 leading-relaxed |
| 강조 수치(지출 합계 등) | text-2xl font-semibold text-white tabular-nums |

## 애니메이션
- fade-in (0.4s) — 카드/섹션 등장
- slide-up (0.5s) — 업로드 완료 후 결과 카드 전환
- 그 외 모든 애니메이션(글로우, 바운스, 무한 반복 등) 금지

## 아이콘
- SVG 인라인, strokeWidth 1.5
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다
