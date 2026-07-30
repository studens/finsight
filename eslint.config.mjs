import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // 실제 앱 코드(src/)만 검사한다. .claude/worktrees/**는 다른 브랜치의 전체
    // 소스 사본이라 여기 포함하면 같은 코드를 여러 번 중복 검사하게 되고,
    // public/deck/**은 벤더 데모 자산, scripts/**는 TDD 대상이 아닌 도구 스크립트다.
    ignores: [
      ".next/**",
      // stop-check.sh의 검증 빌드 출력(next.config.ts의 NEXT_DIST_DIR)
      ".next-check/**",
      "node_modules/**",
      "coverage/**",
      ".claude/**",
      "public/**",
      "scripts/**",
      "phases/**",
      "_workspace/**",
      "next-env.d.ts",
    ],
  },
];
