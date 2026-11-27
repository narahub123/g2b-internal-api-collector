/** 저장 목록을 읽거나 탐색 조건이 바뀌는 동안 진행 상태를 알린다. */
export default function LoadingDictionary() {
  return <p role="status" className="text-sm text-muted-foreground">사전 목록을 불러오는 중입니다.</p>;
}
