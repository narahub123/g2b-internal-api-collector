"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { contractRequestRevision } from "@/entities/contract-request/model/contract-request";
import { contractRevision } from "@/entities/contract/model/contract";
import type { NoticeKey } from "@/entities/notice";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { waitForNoticeJob } from "../api/wait-for-notice-job";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { contractApiPath, contractRequestApiPath, openingResultApiPath } from "../api/routes";
import { parseCollectNoticeInput } from "../model/input";
import { orderPlanUnavailableMessage, orderPlanUnprocessableStatus } from "@/shared/config/g2b-order-plan";
import { priorSpecUnavailableMessage, priorSpecUnavailableStatus } from "@/shared/config/g2b-prior-spec";

// 기존 API가 요구하는 번호와 차수 형식으로 입력을 변환한다.
const settings = {
  "order-plans": { number: "발주계획번호", endpoint: ({ number }) => `/api/order-plans/${encodeURIComponent(number)}` },
  "prior-specs": { number: "사전규격등록번호", endpoint: ({ number }) => `/api/prior-specs/${encodeURIComponent(number)}` },
  "contract-requests": {
    number: "계약요청접수번호", revision: "차수", normalizeRevision: contractRequestRevision, defaultRevision: "000",
    endpoint: contractRequestApiPath,
  },
  contracts: {
    number: "계약번호", revision: "변경차수", normalizeRevision: contractRevision, defaultRevision: "00",
    endpoint: contractApiPath,
  },
  notices: {
    number: "공고번호", revision: "공고차수", normalizeRevision: contractRequestRevision, defaultRevision: "000",
    endpoint: () => "/api/notices", methodCode: true,
  },
  "opening-results": {
    number: "공고번호", revision: "공고차수", normalizeRevision: contractRequestRevision, defaultRevision: "000",
    endpoint: openingResultApiPath, methodCode: true,
  },
} satisfies Record<CollectionSection, {
  number: string;
  revision?: string;
  defaultRevision?: string;
  normalizeRevision?: (value: unknown) => string | undefined;
  endpoint: (key: NoticeKey) => string;
  methodCode?: boolean;
}>;


/**
 * 다른 업무 번호 안내는 모바일에서 의미별로 세 줄로 표시한다.
 * 그 외 오류는 기존 메시지 형식을 유지한다.
 */
function CollectionErrorMessage({ message }: { message: string }) {
  const match = message.match(
    /^(입력한 번호는 .+입니다\.) (.+입력해 주세요\.) (예시: .+)$/,
  );

  if (!match) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
    );
  }

  return (
    <p role="alert" className="text-sm text-destructive">
      <span className="sm:hidden">
        <span className="block">{match[1]}</span>
        <span className="block">{match[2]}</span>
        <span className="block">{match[3]}</span>
      </span>
      <span className="hidden sm:inline">{message}</span>
    </p>
  );
}


/**
 * 업무에 필요한 식별자를 받아 기존 수집 API에 제출한다.
 * 업무별 번호 형식을 제출 전에 검사해 오입력이 수집 이력에 남는 것을 막는다.
 * 오류가 나면 입력을 유지하고, 성공하면 정규화한 식별자를 전달한 뒤 화면 전환 처리가 끝날 때까지 제출을 막는다.
 * 발주계획 미존재와 사전규격 상세 조회 불가는 현재 화면에서 안내한다.
 * @param props.onCollected 저장 성공 뒤 화면을 갱신하고 이동한다. 실패하면 수집 완료와 화면 갱신 실패를 함께 안내한다.
 * @param props.onFailure 일부 자료가 저장되었을 수 있으므로 호출 화면의 목록과 집계를 갱신한다.
 */
export function CollectG2bForm({ section, onCollected, onFailure }: {
  section: CollectionSection;
  onCollected: (key: NoticeKey) => Promise<void>;
  onFailure: () => void;
}) {
  const config = settings[section];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [jobId, setJobId] = useState<number>();
  const requestController = useRef<AbortController>(null);
  useEffect(() => () => requestController.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setMessage("");
    const fields = new FormData(event.currentTarget);
    const number = String(fields.get("number") ?? "").trim().toUpperCase();
    const revision = "normalizeRevision" in config ? config.normalizeRevision(fields.get("revision")) : "";
    if (!number || revision === undefined) {
      setError("번호와 차수 입력을 확인하세요.");
      return;
    }
    const key = { number, revision };
    const methodCode = "methodCode" in config ? String(fields.get("methodCode")).trim() : "";
    const noticeInput = "methodCode" in config ? parseCollectNoticeInput({ ...key, methodCode }) : undefined;
    if (noticeInput === null) {
      setError("공고번호, 공고차수와 낙찰방법 코드를 확인하세요.");
      return;
    }

    const body = section === "notices" ? noticeInput : section === "opening-results" ? { methodCode } : undefined;
    setError("");
    setPending(true);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const response = await fetch(config.endpoint(key), {
        method: "POST",
        signal: controller.signal,
        ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        const message = result?.error ?? "나라장터 데이터를 수집하지 못했습니다.";
        const failedRevisions = result?.failedRevisions?.join(", ");
        setError([
          message,
          section === "opening-results" && result?.noticeSaved ? "입찰공고는 저장되어 있습니다." : "",
          failedRevisions ? `실패한 개찰차수 ${failedRevisions}` : "",
        ].filter(Boolean).join(" "));
        onFailure();
        return;
      }
      if ((section === "order-plans" || section === "prior-specs") && response.status === 200) {
        const result = await response.json();
        if (section === "order-plans" && result?.status === orderPlanUnprocessableStatus) {
          setMessage(orderPlanUnavailableMessage);
          return;
        }
        if (section === "prior-specs" && result?.status === priorSpecUnavailableStatus) {
          setMessage(priorSpecUnavailableMessage);
          return;
        }
      }
      await waitForNoticeJob(response, setJobId, controller.signal);
      try {
        await onCollected(key);
      } catch {
        setError("수집은 완료됐지만 목록을 갱신하지 못했습니다. 페이지를 새로고침해 주세요.");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : "수집 요청을 완료하지 못했습니다.");
      onFailure();
    } finally {
      setJobId(undefined);
      setPending(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-40 flex-[2] gap-1.5 text-sm font-medium">
          {config.number}<Input name="number" required />
        </label>
        {"revision" in config && (
          <label className="grid min-w-24 flex-1 gap-1.5 text-sm font-medium">
            {config.revision}
            <Input name="revision" required inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={config.defaultRevision} />
          </label>
        )}
        {"methodCode" in config && (
          <label className="grid min-w-36 flex-1 gap-1.5 text-sm font-medium">
            낙찰방법 코드 (선택)<Input name="methodCode" maxLength={30} />
          </label>
        )}
        <Button type="submit" disabled={pending}>{pending ? "수집 중…" : "수집 / 다시 수집"}</Button>
      </form>
      {jobId && <p role="status" className="text-sm">수집 작업 {jobId} 접수됨</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {error && <CollectionErrorMessage message={error} />}
    </Card>
  );
}
