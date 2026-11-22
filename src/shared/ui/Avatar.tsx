"use client";

import { useState } from "react";

/**
 * 사용자 프로필 이미지를 표시하고 누락되거나 불러오지 못하면 닉네임 첫 글자를 표시한다.
 * @param props.nickname 서버 세션에서 읽은 표시 이름.
 * @param props.image 공급자 프로필 이미지 주소 또는 이미지 없음.
 * @returns 이미지 또는 첫 글자 대체 표시를 가진 공통 아바타.
 */
export function Avatar({ nickname, image }: { nickname: string; image: string | null }) {
  // 실패한 주소만 기억해 이후 다른 프로필 주소가 들어오면 정상적으로 시도한다.
  const [failed, setFailed] = useState<string | null>(null);
  const first = Array.from(nickname.trim())[0]?.toUpperCase() ?? "";
  return (
    <span aria-hidden="true" className="inline-grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-medium">
      {/* 외부 공급자 이미지는 요청 참조 주소 없이 읽고, 깨진 이미지는 대체 표시한다. */}
      {image && failed !== image
        ? <img src={image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(image)} />
        : first}
    </span>
  );
}
