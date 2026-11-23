import type { ReactNode } from "react";

/** 공통 본문에 배치할 화면과 기존 본문 식별자. */
type ServiceMainProps = {
  /** 공통 너비 안에 표시할 화면 콘텐츠. */
  children: ReactNode;
  /** 기존 본문을 찾는 데 사용하는 식별자. */
  slot?: string;
};

/**
 * 관리자 화면과 같은 바깥 여백을 적용하고 공통 최대 너비 안에 본문을 배치한다.
 * @param props.children 본문에 표시할 화면 콘텐츠.
 * @param props.slot 화면에서 사용하는 선택 본문 식별자.
 * @returns 가운데 정렬된 서비스 본문.
 */
export function ServiceMain({ children, slot }: ServiceMainProps) {
  // 좌우 여백을 최대 너비 영역 바깥에 두어 넓은 화면에서 본문 기준선을 맞춘다.
  return (
    <main data-slot={slot} className="min-w-0 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full min-w-0 max-w-5xl">{children}</div>
    </main>
  );
}
