"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { toast } from "sonner";
import { businessFetch } from "@/features/service-auth/business-client";
import { BUSINESS_AUTH_HEADER, DOWNLOAD_DESTINATION_HEADER } from "@/shared/model/business-auth";

/**
 * 내부 첨부 요청의 인증 결과를 확인하고 검증된 다운로드 주소를 브라우저에서 연다.
 * @param props.href 내부 다운로드 API 또는 기존 일반 링크 주소.
 * @returns 기본 링크 동작과 보호 다운로드 처리를 제공하는 앵커.
 */
export function AttachmentLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  /**
   * 일반 클릭에서만 서비스의 보호 다운로드를 먼저 요청한다.
   * @param event 브라우저의 링크 클릭 및 보조 키 정보.
   */
  async function download(event: MouseEvent<HTMLAnchorElement>) {
    if (!href?.startsWith("/api/") || event.button !== 0 || event.metaKey || event.ctrlKey
      || event.shiftKey || event.altKey || props.target) return;
    event.preventDefault();
    try {
      // 같은 업무를 두 번 수행하지 않도록 302 대신 검증된 목적지만 받는다.
      const response = await businessFetch(href, { headers: { [DOWNLOAD_DESTINATION_HEADER]: "1" } });
      if (response.headers.has(BUSINESS_AUTH_HEADER)) return;
      if (!response.ok) throw new Error("첨부 다운로드 요청 실패");
      const payload = await response.json();
      const destination = new URL(payload.location);
      if (destination.protocol !== "https:") throw new Error("첨부 다운로드 주소 오류");
      window.location.assign(destination.href);
    } catch {
      toast.error("첨부 다운로드를 시작하지 못했습니다.", { id: "g2b-download-error" });
    }
  }

  return <a {...props} href={href} onClick={download} />;
}
