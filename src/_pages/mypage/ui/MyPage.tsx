import { ServiceMain } from "@/shared/ui/ServiceMain";

/**
 * 마이페이지 본문을 구성한다.
 * @returns 마이페이지 화면.
 */
export default function MyPage() {
  // 공통 본문에 마이페이지 콘텐츠를 배치한다.
  return (
    <ServiceMain>
      {/* 마이페이지 콘텐츠 영역 */}
      <div className="grid gap-4">
        {/* 페이지 제목 */}
        <h1 className="text-2xl font-semibold">마이페이지</h1>
      </div>
    </ServiceMain>
  );
}
