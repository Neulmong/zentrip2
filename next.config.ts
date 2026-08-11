import type { NextConfig } from "next";

/**
 * spec §17.2 — 공개 페이지는 `next/image`를 쓴다. 원격 이미지는 허용 패턴을
 * 명시해야 최적화기가 받아준다.
 *
 * 호스트를 하드코딩하지 않고 `SUPABASE_URL`에서 뽑는 이유: 로컬·프리뷰·운영이
 * 서로 다른 프로젝트를 가리킬 수 있고, 값은 이미 환경 변수로 관리된다(§4).
 * `pathname`을 공개 버킷 경로로 좁혀 임의 원격 이미지를 최적화기에 태우지 못하게 한다.
 *
 * 빌드는 환경 변수 없이 돌 수 있어야 하므로(`lib/env`가 접근 시점에 검사하는
 * 것과 같은 이유) 값이 없으면 패턴을 비운다 — 이미지가 안 나올 뿐 빌드는 통과한다.
 */
function supabaseImagePattern() {
  const raw = process.env.SUPABASE_URL;
  if (!raw) return [];
  try {
    const { protocol, hostname } = new URL(raw);
    return [{
      protocol: protocol.replace(":", "") as "http" | "https",
      hostname,
      pathname: "/storage/v1/object/public/product-images/**",
    }];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseImagePattern(),
  },
};

export default nextConfig;
