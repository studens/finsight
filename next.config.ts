import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // 검증용 빌드(stop-check.sh)가 실행 중인 dev 서버의 .next를 덮어쓰지 않도록
  // 빌드 출력 위치를 환경변수로 분리할 수 있게 한다.
  // 같은 .next를 dev와 build가 동시에 쓰면 청크 참조가 깨진다.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pdfjs-dist"],
}

export default nextConfig
