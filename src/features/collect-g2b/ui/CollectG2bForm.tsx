"use client";

import { useState, type FormEvent } from "react";
import { contractRequestRevision } from "@/entities/contract-request/model/contract-request";
import { contractRevision } from "@/entities/contract/model/contract";
import type { NoticeKey } from "@/entities/notice";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { contractApiPath, contractRequestApiPath, openingResultApiPath } from "../api/routes";
import { parseCollectNoticeInput } from "../model/input";

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
 * 업무에 필요한 식별자를 받아 기존 수집 API에 제출한다.
 * 오류가 나면 입력을 유지하고, 성공하면 정규화한 식별자를 호출자에게 전달한다.
 * @param props.onFailure 일부 자료가 저장되었을 수 있으므로 호출 화면의 목록과 집계를 갱신한다.
 */
export function CollectG2bForm({ section, onCollected, onFailure }: {
  section: CollectionSection;
  onCollected: (key: NoticeKey) => void;
  onFailure: () => void;
}) {
  const config = settings[section];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    const number = g2bNumber(String(fields.get("number")).toUpperCase());
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
    try {
      const response = await fetch(config.endpoint(key), {
        method: "POST",
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
      onCollected(key);
    } catch {
      setError("수집 요청을 완료하지 못했습니다. 다시 시도해 주세요.");
      onFailure();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-40 flex-[2] gap-1.5 text-sm font-medium">
          {config.number}<Input name="number" required maxLength={30} />
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
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}
