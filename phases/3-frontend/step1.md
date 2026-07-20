# Step 1: ErrorModal — 에러 코드 은닉 통일 모달 + useApiError 훅

## 작업
API가 반환하는 정확한 상태 코드(`403 PAYWALL_REQUIRED` / `404 NOT_FOUND` / `502 GENERATION_FAILED` / `400 BAD_REQUEST` / `401 UNAUTHORIZED`)를 사용자에게 **그대로 노출하지 않고**, 세 케이스(주로 403/404/502)를 모두 **같은 부드러운 모달** 하나로 표시하는 공용 컴포넌트를 만든다. (ARCHITECTURE flow 5 그대로.)

파일:
- `src/components/ErrorModal.tsx` — Client Component.
- `src/hooks/useApiError.ts` — fetch 응답을 받아 에러 상태를 관리하는 훅(에러 여부 + 모달 open/close).

동작:
1. fetch 응답이 실패(`!res.ok`)면 body의 `{ code }`를 읽되, **화면에는 code를 노출하지 않는다.** 코드별로 부드러운 한국어 문구로 매핑한다:
   - `PAYWALL_REQUIRED` → "이 리포트는 Premium 구독에서 확인할 수 있어요."
   - `NOT_FOUND` → "요청하신 분석을 찾을 수 없어요. 다시 시도해 주세요."
   - `GENERATION_FAILED` → "리포트를 생성하지 못했어요. 잠시 후 다시 시도해 주세요."
   - `BAD_REQUEST` → "파일을 읽지 못했어요. CSV 형식을 확인해 주세요."
   - 그 외/알 수 없음 → "문제가 발생했어요. 잠시 후 다시 시도해 주세요."
2. 모달은 페이지 이동 없이 현재 화면 위에 뜨고, 닫기 버튼으로만 닫힌다(현재 화면 유지).
3. 모달 스타일(ui-design 값 그대로):
   - 오버레이는 반투명 어두운 배경(`bg-black/60`). **`backdrop-filter: blur()` 금지.**
   - 패널: `rounded-[24px] bg-[#16181c] p-8`, 본문 텍스트 `text-sm text-[#a8acb3] leading-relaxed`, 제목 `text-white`.
   - 닫기 버튼: Secondary 버튼(`h-14 px-8 rounded-full bg-transparent border border-[#33363c] text-white`). PAYWALL 케이스에 한해 추가로 Primary 버튼("Premium 보기") 노출 가능.
   - 등장 애니메이션 `fade-in`(0.4s)만. 글로우/바운스 금지.

## Acceptance Criteria
- [ ] `useApiError`가 `{ code: "PAYWALL_REQUIRED" }`, `{ code: "NOT_FOUND" }`, `{ code: "GENERATION_FAILED" }` 각각을 받았을 때 위의 부드러운 문구를 반환하고, 화면 문자열에 `PAYWALL_REQUIRED`/`404`/`502` 같은 코드·상태숫자가 포함되지 않음을 Vitest 테스트로 확인한다.
- [ ] 세 코드(403/404/502) 모두 **동일한 `ErrorModal` 컴포넌트**로 렌더됨을 테스트로 확인한다(코드별로 다른 모달 컴포넌트를 만들지 않는다).
- [ ] 알 수 없는 code나 body 파싱 실패 시 기본 문구("문제가 발생했어요…")로 폴백하는 테스트가 통과한다.
- [ ] `ErrorModal` 오버레이/패널에 `backdrop-blur`·`backdrop-filter`가 없고, 패널이 `rounded-[24px] bg-[#16181c]`임을 렌더 테스트/grep으로 확인한다.
- [ ] 모달이 뜬 뒤에도 라우팅(페이지 이동)이 일어나지 않고 닫기로만 사라지는 동작이 테스트로 확인된다.
