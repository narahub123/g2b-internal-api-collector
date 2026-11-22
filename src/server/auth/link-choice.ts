import { createHash } from "node:crypto";
import { getG2bDatabase } from "@/server/g2b/repository";
import { readOAuthFlow } from "./oauth-flow";
import type { OAuthLinkChoice } from "./oauth-state";
import { openAuthRepository } from "./repository";

/**
 * 요청한 브라우저의 쿠키가 최초 인증을 마친 선택 상태인지 확인한다.
 * @param state 선택 화면 또는 추가 인증이 참조하는 최초 요청 키.
 * @returns 동일 이메일 후보를 조회할 수 있는 확인된 상태 또는 undefined.
 * @throws 쿠키의 서버 인증 설정을 확인할 수 없는 경우.
 */
export async function readLinkChoice(state: unknown): Promise<OAuthLinkChoice | undefined> {
  // 코드 교환 대기나 일반 가입 초안은 후보를 조회할 수 없다.
  const flow = await readOAuthFlow(state);
  if (flow?.stage === "link-choice") return flow;
}

/**
 * 최초 OAuth에서 확인한 이메일의 후보를 해당 흐름 전용 선택값으로 변환한다.
 * @param flow 최초 인증을 통과한 가입 선택 상태.
 * @returns 서버에서만 사용할 내부 ID, 폼에 전달할 선택값과 표시 이름.
 * @throws 후보 조회가 실패한 경우 저장소 오류를 전달한다.
 */
export async function listLinkChoices(flow: OAuthLinkChoice) {
  // 입력 폼이나 이메일 쿼리는 후보 조회에 사용하지 않는다.
  const repository = openAuthRepository(getG2bDatabase());
  const candidates = await repository.findEmailCandidates(flow.identity.email);
  /**
   * 내부 ID를 흐름별 선택값으로 바꾸고 구분에 필요한 이름 첫 글자만 노출한다.
   * @param candidate 저장소에서 읽은 후보 계정.
   * @param index 같은 이름이 있는 후보도 구분할 표시 순서.
   * @returns 서버 ID와 검증용 선택값, 공개 라벨.
   */
  return candidates.map(({ id, nickname }, index) => {
    const selection = createHash("sha256").update(flow.state).update(id).digest("base64url");
    const initial = Array.from(nickname.trim())[0];
    return { id, selection, label: initial ? `계정 ${index + 1} (${initial}**)` : `계정 ${index + 1}` };
  });
}
