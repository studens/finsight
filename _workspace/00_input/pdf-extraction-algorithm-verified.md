# 검증된 PDF 거래내역 추출 알고리즘 (리더 실측)

> 리더가 실제 NH농협 이용대금명세서 PDF에 대해 `pdfjs-dist@4.10.38`로 직접 실행해
> **거래 34건 / 청구금액 합계 882,646원 (명세서 `합계` 행과 오차 0)** 을 확인한 절차다.
>
> Codex는 이 절차를 TypeScript로 이식하면 된다. **알고리즘을 새로 발명하지 마라.**
> 단, 아래 좌표 상수(275.5 / 407.0 / 445.5 / 558.5)는 NH농협 고유값이므로
> **하드코딩하지 말고 right-edge 클러스터를 동적으로 발견**해야 한다.

## 검증 스크립트 (Node, 실제로 통과한 코드)

```js
import fs from 'node:fs'
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const data = new Uint8Array(fs.readFileSync(PATH))
const doc = await pdfjs.getDocument({
  data,
  password: '******',
  isEvalSupported: false,   // Vercel Node 런타임 대비
  useSystemFonts: false,    // 시스템 폰트 접근 회피
}).promise

const tc = await (await doc.getPage(2)).getTextContent()
const raw = tc.items
  .filter(i => i.str && i.str.trim())
  .map(i => ({ y: i.transform[5], x: i.transform[4], w: i.width, s: i.str }))

// ── 1) fuzzy y 클러스터링 (tolerance 0.5pt) — 생략하면 조용한 누락 발생
const clusters = []
for (const it of [...raw].sort((a, b) => b.y - a.y)) {
  const c = clusters.find(c => Math.abs(c.y - it.y) < 0.5)
  if (c) {
    c.items.push(it)
    c.y = (c.y * (c.items.length - 1) + it.y) / c.items.length
  } else {
    clusters.push({ y: it.y, items: [it] })
  }
}

// ── 2) 행별 처리
const COL = { used: 275.5, billed: 407.0, point: 445.5, remain: 558.5 } // ← 동적 발견 대상
const num = s => (/^-?[\d,]+$/.test(s.trim()) ? Number(s.replace(/,/g, '')) : null)

let sum = 0
const counted = []
for (const c of clusters) {
  c.items.sort((a, b) => a.x - b.x)
  const first = c.items[0].s.trim()
  const line = c.items.map(i => i.s).join('')

  if (!/^\d{2}\/\d{2}/.test(first)) continue      // 거래행만
  if (/소계|합계/.test(line)) continue             // 이중계상 방지 + 실명 포함 행 배제

  // 청구금액 컬럼(right-edge)에 값이 정확히 1개 있는 행만 계상
  // → 해외이용 섹션 행은 이 컬럼이 없어 자동 탈락 (중복계상 방지가 여기서 해결됨)
  const billed = c.items.filter(
    i => Math.abs((i.x + i.w) - COL.billed) < 1.5 && num(i.s) !== null,
  )
  if (billed.length !== 1) continue

  sum += num(billed[0].s)
  counted.push({ y: c.y, amount: num(billed[0].s), line })
}
// 결과: counted.length === 34, sum === 882646
```

## 실행 결과 (실측 로그)

```
fuzzy 클러스터 행 수 = 49 (정밀 y 고유값 53개 대비)

계상된 거래 = 34 건, 합계 = 882,646
기대값(명세서 합계) = 882,646  차이 = 0

--- 제외된 행 ---
  y=350.28 | 소계(M614)(***)올바른BAZIC+카드866,64690277,200
  y=324.76 | 소계(L069)(***)채움뉴후불하이패스(16,0000
  y=312.03 | 합계882,64690277,200
  y=242.57 | NO-BILLED: 07/03M614WWW.ALIEXPRES룩셈부르크USD23.3923.621,554.6036...
  y=229.82 | 합계36,7199036,809
```

제외된 5행이 **정확히 우리가 배제하려던 것들**이다:
- 소계 2행 (실명 포함 → 레댁션 대상이자 이중계상 원인)
- 합계 2행 (본 표 합계 + 해외 섹션 합계)
- 해외이용 상세 1행 (`07/03 ALIEXPRESS`는 본 표에 이미 36,719으로 계상됨 → 중복 회피)

## 실패했던 접근 (회귀 방지용 — 반드시 AC로 막을 것)

`y`를 `Math.round(y * 10) / 10`으로 **정확히 반올림**해 그룹핑했을 때:

```
계상된 거래 = 24 건, 합계 = 702,397   ← 34건/882,646이어야 함
차이 = 180,249  (10건 누락, 조용히 실패)
```

원인: 한 시각적 행이 두 y값으로 갈라진다 (예: 소계 행 `350.33` / `350.26`, 합계 행 `312.07` / `312.00`).
**에러 없이 금액만 틀리게 나오므로 테스트가 없으면 발견되지 않는다.**

## 비밀번호 예외 구분 (실측)

```
비밀번호 미제공 → PasswordException, name='PasswordException', code=1, message='No password given'
틀린 비밀번호   → PasswordException, code=2
올바른 비밀번호 → 정상 오픈 (numPages=3)
```

`code`로 두 경우를 구분할 수 있다. 둘 다 HTTP 409 `PDF_PASSWORD_REQUIRED`로 매핑하되,
프론트 안내 문구는 구분할 수 있게 응답에 **비밀번호를 담지 않는 방식으로** 힌트를 전달할지 결정하라.

## INV-3 레댁션 게이트 — 실제 데이터로 검증 완료

리더가 실제 PDF에서 **LLM에 전송될 payload를 그대로 재현**해 PII 잔존 여부를 검사했다.

payload 구성: 전 페이지에서 fuzzy y 클러스터링 → 거래행(`^\d{2}/\d{2}`)만 → 소계/합계 배제
→ 행별 `{ right: x+width, s: 문자열 }` 배열. **결과: 35행 / 9,619 바이트.**

```
=== 레댁션 게이트 검사 (LLM 전송 payload) ===
  ✅ 없음  실제 실명
  ✅ 없음  주소 키워드 ([REDACTED_REAL_ADDRESS]|[REDACTED_REAL_ADDRESS]|[REDACTED_REAL_ADDRESS_DETAIL]|[REDACTED_REAL_ADDRESS_DETAIL])
  ✅ 없음  우편번호 5자리 ([REDACTED_POSTCODE])
  ✅ 없음  계좌형태 (\d{3}\*{4,}\d{2})
  ✅ 없음  카드번호 13~16자리
  ✅ 없음  전화번호
  ✅ 없음  고객번호 ([REDACTED_CUSTOMER_NO])

✅ 게이트 통과 — 거래행만 추출하면 PII가 남지 않는다
```

**핵심:** PII는 page1의 청구요약·주소 블록과 소계 행(실명 포함)에만 있고,
**거래행 필터 + 소계/합계 배제만으로 구조적으로 전부 탈락한다.** 문자열 치환 레댁션에 의존하지 않는다.

단, 게이트는 **방어선으로서 여전히 필요하다** — 다른 카드사 레이아웃에서 거래행에 PII가 섞일 수 있고,
게이트가 없으면 그때 조용히 유출된다. 위 7가지 패턴을 **차단형(예외 throw)** 으로 구현하라.

payload 샘플 (LLM이 실제로 보는 형태):
```json
{"page":2,"cells":[{"right":56.8,"s":"06/23"},{"right":94.5,"s":"기본연회비"},
 {"right":117.8,"s":"올바른"},{"right":143.1,"s":"BAZIC+"},{"right":156.8,"s":"카드"},
 {"right":275.5,"s":"6,000"},{"right":407,"s":"6,000"},...]}
```
LLM이 판정할 것은 **`right` 값별로 그 컬럼이 무엇인지**뿐이다(이용금액/청구금액/포인트/할부잔여).
가맹점명·금액 자체를 LLM이 재작성하게 하지 마라 — 숫자는 코드가 다룬다.

참고: 이 payload는 35행인데 최종 계상은 34건이다. 차이 1건은 해외이용 섹션 행이며
"청구금액 컬럼 값이 정확히 1개" 규칙에서 탈락한다(정상).

## 이미지(스캔) PDF 판정

`텍스트 아이템 0개`를 기준으로 삼지 마라 — 실측에서 마지막 페이지는 푸터만 있어 아이템이 6개다.
**문서 전체에서 거래행 후보(위 절차 4단계 통과)가 0건**인 경우를 기준으로 한다.
