import { DictionaryManagement } from "./DictionaryManagement";
import { getDictionaryCards } from "./dictionary-server";
import { getDictionaryQueue } from "@/server/collections/dictionary-queue";

/** 관리 화면에 전달할 사전별 메타데이터를 요청 시점에 읽는다. */
export async function DictionaryManagementPage() {
  // 설정과 Blob 집계는 서로 다른 저장소에서 한 번씩 읽는다.
  const [cards, settings] = await Promise.all([getDictionaryCards(), getDictionaryQueue().settings()]);
  return <DictionaryManagement cards={cards} settings={settings} />;
}
