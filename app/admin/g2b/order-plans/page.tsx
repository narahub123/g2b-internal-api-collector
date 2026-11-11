import { G2B_SECTIONS } from "@/shared/config/g2b-sections";

/**
 * 공통 관리자 본문에 발주계획 화면의 제목을 표시한다.
 */
export default function Page() {
  return <h1 className="text-2xl font-semibold">{G2B_SECTIONS["order-plans"]}</h1>;
}
