---
name: visual-check
description: "Playwright/브라우저 MCP가 없는 이 환경에서 UI 변경사항을 headless Chrome + CDP로 검증하는 표준 방법. 스크린샷, 콘솔 에러, 가로 스크롤 오버플로(scrollWidth)를 확인해야 할 때, 또는 특정 카드/컴포넌트만 확대해서 봐야 할 때 이 스킬을 먼저 로드한다."
---

# 브라우저 시각 검증 (Playwright 없는 환경)

이 프로젝트엔 아직 Playwright/브라우저 MCP가 설치돼 있지 않다(`docs`의 TODO 참고). 그동안 UI 변경을 직접 눈으로 확인해야 할 때는 매번 headless Chrome + CDP 스크립트를 새로 짜지 말고 `scripts/visual-check.js`를 쓴다.

## 사용법

```bash
# 1. dev 서버(또는 next start) 먼저 기동
npm run dev  # 기본 :3000, 이미 떠 있으면 생략

# 2. 데스크톱 풀페이지
node scripts/visual-check.js http://localhost:3000/

# 3. 모바일(390px) 풀페이지 — 오버플로 체크 포함
node scripts/visual-check.js http://localhost:3000/ --mobile

# 4. 특정 카드/컴포넌트만 확대 캡처 (텍스트로 찾음)
node scripts/visual-check.js http://localhost:3000/ --select="인사이트 확인" --out=/tmp/step3.png
```

출력은 JSON 한 줄:
```json
{
  "url": "...", "mode": "desktop", "viewportWidth": 1280,
  "scrollWidth": 1265, "overflow": false,
  "consoleErrors": [], "saved": "/tmp/....png"
}
```

- `overflow: true`면 가로 스크롤이 생긴다는 뜻 — `scrollWidth`가 `viewportWidth`보다 크면 CSS 어딘가 폭 계산이 깨졌다는 신호.
- `consoleErrors`가 비지 않으면 실제 런타임 에러일 수도, `/favicon.ico` 404처럼 무해한 것일 수도 있다 — 반드시 `curl -I <url>`로 실제 응답을 확인해서 진짜 문제인지 구분한다.
- 결과 PNG는 Read 툴로 그대로 열어서 눈으로 확인한다.

## 표준 확인 세트

화면 하나를 검증할 때 최소 이 두 가지는 같이 확인한다(데스크톱 전용 확인은 헤드리스 렌더링 최소폭 아티팩트로 오탐할 수 있어 신뢰하지 않는다):
1. 데스크톱(1280px) 풀페이지
2. 모바일(390px) 풀페이지 + `overflow` 값

인증이 필요한 화면(대시보드 등)을 로그인 없이 봐야 할 때는, 실제 라우트를 임시로 바꾸지 말고 스크래치 라우트(예: `src/app/dev-preview/page.tsx`에 목업 데이터로 같은 컴포넌트 직접 렌더)를 만들어 확인 후 **커밋 전에 반드시 삭제**한다.

## 알아두면 좋은 것

- 이 스크립트는 실행마다 자체적으로 headless Chrome을 띄우고 끝나면 종료한다 — 별도로 Chrome을 미리 켜둘 필요 없다.
- dev 서버는 이 스크립트가 관리하지 않는다 — 검증이 끝나면 직접 종료할 것(`pkill -f "next dev -p <포트>"`).
- 근본적으로는 TODO에 있는 Playwright E2E 셋업이 이 스킬을 대체해야 한다. 이건 그 전까지의 임시 대체 수단이다.
