import { DictionaryManagement } from "./DictionaryManagement";
import { getDictionaryCards } from "./dictionary-server";

/** 관리 화면에 전달할 사전별 메타데이터를 요청 시점에 읽는다. */
export async function DictionaryManagementPage() {
  const cards = await getDictionaryCards();
  return <DictionaryManagement cards={cards} />;
}
