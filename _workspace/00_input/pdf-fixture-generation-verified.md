# 검증된 합성 픽스처 생성 방법 (리더 실측)

> step0의 숨은 리스크였던 **"암호화된 PDF 픽스처를 Node에서 만들 수 있는가"** 를 리더가 실제로 검증했다.
> 결론: **가능하다.** `pdfkit`으로 한글 포함 AES 암호화 PDF를 생성하고, `pdfjs-dist`가 비밀번호로 열고,
> `pdf-extraction-algorithm-verified.md`의 **동일 알고리즘이 정확한 합계를 추출**하는 왕복을 확인했다.

## 왜 이 방법인가

| 후보 | 결과 |
|---|---|
| `pdf-lib` | ❌ 암호화 미지원 |
| `qpdf` CLI | ❌ 이 환경에 미설치 |
| **`pdfkit`** | ✅ `userPassword`/`ownerPassword` 지원, 한글 TTF 임베드 가능, 좌표 직접 지정 가능 |

`pdfkit`은 좌표를 직접 지정할 수 있어 **실제 명세서의 right-edge 정렬을 그대로 재현**할 수 있다.
이게 결정적이다 — 픽스처가 실제 레이아웃의 오른쪽 정렬 특성을 갖지 않으면 파서 테스트가 의미가 없다.

## 중요: 폰트 의존성은 테스트 시점이 아니라 생성 시점에만 있다

생성 스크립트는 macOS 시스템 폰트(`/System/Library/Fonts/Supplemental/AppleGothic.ttf`)를 쓴다.
Linux CI/Vercel엔 이 경로가 없지만 **문제되지 않는다** — 픽스처 PDF는 한 번 생성해 **저장소에 커밋**하고,
테스트는 그 PDF를 읽기만 한다. 생성 스크립트는 개발용 도구(`scripts/` 또는 devDependency)로 두고
**테스트 실행 경로에 폰트 의존성이 들어가지 않게** 하라.

## 검증된 생성 스크립트 (실제로 통과한 코드)

```js
import fs from 'node:fs'
import PDFDocument from 'pdfkit'

// 가명 데이터 — 실제 명세서의 행 변형만 재현. 실명/주소/계좌 절대 포함 금지.
// [날짜, 가맹점, 이용금액, 할인, 할부회차, 청구금액, 포인트, 할부잔여]
const TX = [
  ['06/23', '기본연회비-바른카드',   6000,  null, null,   6000, 0, null],  // 연회비
  ['06/01', '포인트결제',            null,  null, null,   -300, 0, null],  // 마이너스, 이용금액 칸 없음
  ['03/20', '테스트페이_강의',     140252,   922, '6/4', 23375, 0, 46750], // 할부 → 23,375만 계상
  ['06/13', '테스트마트 강변점',     4500,    53, null,   4447, 0, null],  // 일반+할인
  ['06/24', '아파트관리비',        246090,  null, null, 246090, 0, null],  // 할인 없음
]

const doc = new PDFDocument({
  size: 'A4', margin: 0,
  userPassword: '000000',        // ← 합성 픽스처 전용 비밀번호
  ownerPassword: 'owner-secret',
  pdfVersion: '1.6',             // AES 사용
})
const out = fs.createWriteStream(OUT_PATH)
doc.pipe(out)
doc.registerFont('ko', '/System/Library/Fonts/Supplemental/AppleGothic.ttf')
doc.font('ko').fontSize(7.8)

// pdfkit은 y가 top-down, pdfjs는 bottom-up → PAGE_H로 변환
const PAGE_H = 841.89
const RIGHT = { used: 275.5, discount: 309.6, billed: 407.0, point: 445.5, remain: 558.5 }
const fmt = n => n.toLocaleString('en-US')

doc.text('이용기간 : [일시불/할부] 2026.06.11 ~ 2026.07.10',
         202.8, PAGE_H - 814.95, { lineBreak: false })

let y = 771.28
for (const [date, merchant, used, disc, inst, billed, point, remain] of TX) {
  const top = PAGE_H - y
  doc.text(date, 36.3, top, { lineBreak: false })
  doc.text(merchant, 60, top, { lineBreak: false })
  // 오른쪽 정렬 — 이게 파서가 의존하는 핵심 특성이다
  const right = (val, edge) => {
    if (val === null) return
    const s = typeof val === 'number' ? fmt(val) : val
    doc.text(s, edge - doc.widthOfString(s), top, { lineBreak: false })
  }
  right(used, RIGHT.used)
  if (disc !== null) right(`${fmt(disc)}(할인)`, RIGHT.discount)
  if (inst) doc.text(inst, 331.7, top, { lineBreak: false })
  right(billed, RIGHT.billed)
  right(point, RIGHT.point)
  right(remain, RIGHT.remain)
  y -= 12.76   // 실측 행 간격
}

// 소계/합계 행 — 실명 대신 가명. 파서가 이 행들을 배제하는지 테스트하는 데 필요하다.
const total = TX.reduce((a, t) => a + t[5], 0)
for (const [label, dy] of [['소계(M614)(홍길동)바른카드', 12.76], ['합계', 25.5]]) {
  const top = PAGE_H - (y - dy)
  doc.text(label, 60, top, { lineBreak: false })
  doc.text(fmt(total), RIGHT.billed - doc.widthOfString(fmt(total)), top, { lineBreak: false })
}
doc.end()
```

## 왕복 검증 결과 (실측 로그)

```
✅ 비밀번호 없이 열기 차단: PasswordException code= 1
✅ 틀린 비밀번호 차단:     PasswordException code= 2

right-edge 히스토그램: 275.5×4  407×7  445.5×5  558.5×1

  계상     6000 | 06/23기본연회비-바른카드6,0006,0000
  계상     -300 | 06/01포인트결제-3000
  계상    23375 | 03/20테스트페이_강의140,252922(할인)6/423,375046,750
  계상     4447 | 06/13테스트마트 강변점4,50053(할인)4,4470
  계상   246090 | 06/24아파트관리비246,090246,0900

결과: 5건, 합계 279,612
기대: 5건, 279,612  → ✅ 일치
실제 실명 포함: ✅ 없음
```

주목할 점:
- `407×7` — right-edge 407에 숫자가 7개인데 계상은 5건이다. 나머지 2개는 **소계/합계 행**이며
  키워드 배제가 정상 동작한 것이다. 즉 **이 픽스처는 소계/합계 배제 로직도 실제로 검증한다.**
- 비밀번호 예외 `code 1`(미제공) / `code 2`(불일치)가 **합성 픽스처에서도 재현**된다
  → 409 분기 테스트를 이 픽스처 하나로 전부 커버할 수 있다.

## 픽스처가 반드시 커버해야 할 것 (AC 근거)

위 5행 + 소계/합계 2행으로 다음이 모두 검증된다:

| 검증 대상 | 커버하는 행 |
|---|---|
| 연회비 계상 | `기본연회비-바른카드` |
| 마이너스 금액 / 이용금액 칸 없음 | `포인트결제 -300` |
| **할부 → 청구액만 계상 (D2)** | `테스트페이_강의` 140,252 중 **23,375만** |
| 일반 + 할인 | `테스트마트 강변점` |
| 할인 없음 | `아파트관리비` |
| 소계/합계 배제 (이중계상 방지) | 소계·합계 2행 |
| 비밀번호 미제공/불일치/성공 | PDF 자체의 암호화 |

**추가로 필요한 것:** 해외이용 섹션 행(청구금액 컬럼 없는 행)을 1행 넣어
"청구금액 컬럼 값이 정확히 1개가 아닌 행은 제외"가 검증되게 하라. 위 스크립트엔 아직 없다.
