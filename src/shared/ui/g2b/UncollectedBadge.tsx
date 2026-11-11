import { Badge } from "../badge";

/** 저장된 업무 자료가 없는 목록 항목과 상세에 빨간색 미수집 상태를 표시한다. */
export function UncollectedBadge() {
  return <Badge variant="destructive">미수집</Badge>;
}
