import Link from "next/link";
import { BusinessForm } from "./BusinessForm";
import { myPageBusinessPath } from "@/shared/config/mypage";
import { formatBusinessNumber } from "@/entities/business/model/business-display";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

/** 목록에 노출할 사업자의 최소 식별 정보다. */
type BusinessSummary = {
  /** 상세 링크의 내부 식별자. */
  id: number;
  /** 저장된 10자리 사업자등록번호. */
  number: string;
  /** 기본정보에서 확인한 업체명. */
  name: string | null;
};

/**
 * 마이페이지 사업자 등록 폼과 현재 사용자 목록을 표시한다.
 * @param props 현재 사용자의 등록 사업자 요약.
 * @returns 기존 마이페이지 카드 스타일의 목록 화면.
 */
export default function BusinessInformation({ businesses }: { businesses: BusinessSummary[] }) {
  // 목록과 등록 폼을 같은 메뉴 안에 배치한다.
  return (
    <div className="grid min-w-0 gap-4">
      <Card>
        <CardHeader><CardTitle>사업자 정보</CardTitle></CardHeader>
        <CardContent><BusinessForm /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>등록된 사업자</CardTitle></CardHeader>
        <CardContent>
          {businesses.length ? (
            // 사업자가 한 건이어도 상세 링크를 선택해야 업무 데이터를 읽는다.
            <ul className="divide-y">
              {businesses.map(({ id, name, number }) => (
                <li key={id}>
                  {/* 링크 노출만으로 선택하지 않은 사업자의 상세를 조회하지 않는다. */}
                  <Link prefetch={false} href={myPageBusinessPath(id)} className="flex flex-wrap items-baseline justify-between gap-2 py-3 hover:underline">
                    {name && <span className="font-medium">{name}</span>}
                    <span className={name ? "text-sm text-muted-foreground" : "font-medium"}>{formatBusinessNumber(number)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">등록된 사업자가 없습니다.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
