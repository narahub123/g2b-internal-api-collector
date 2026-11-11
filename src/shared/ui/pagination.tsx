import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/** 목록의 페이지 이동 영역을 보조 기술에서 구분할 수 있게 한다. */
export function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return <nav aria-label="페이지 이동" data-slot="pagination" className={cn("mx-auto flex w-full justify-center", className)} {...props} />;
}

/** 페이지 번호와 이동 버튼을 같은 순서로 배치하고 좁은 화면에서는 줄바꿈을 허용한다. */
export function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return <ul data-slot="pagination-content" className={cn("flex flex-wrap items-center justify-center gap-1", className)} {...props} />;
}

/** 페이지 이동 항목에 목록 의미를 부여한다. */
export function PaginationItem(props: ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}
