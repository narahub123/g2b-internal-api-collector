"use client";

import { Avatar, AvatarImage, AvatarFallback } from "@/shared/ui/Avatar";
import { cn } from "@/shared/lib/utils";

/** 사용자 아바타 표시 및 스타일 설정에 필요한 속성. */
type UserAvatarProps = {
  // 이미지가 없을 때 대체 표시에 사용할 닉네임.
  nickname: string;
  // 사용자 프로필 이미지 주소.
  image: string | null;
  // 사용처에서 크기와 스타일을 변경하기 위한 추가 클래스.
  className?: string;
};

/**
 * 사용자 프로필 이미지를 표시하고 이미지가 없거나
 * 로딩에 실패하면 닉네임 첫 글자를 표시한다.
 * @param props 사용자 프로필 및 추가 스타일 정보.
 * @returns shadcn/ui 기반의 공통 사용자 아바타.
 */
export function UserAvatar({ nickname, image, className }: UserAvatarProps) {
  // 닉네임의 첫 글자를 추출하여 이미지 대체 표시로 사용한다.
  const first = Array.from(nickname.trim())[0]?.toUpperCase() ?? "";

  // 기존 기본 스타일을 유지하면서 사용처의 추가 스타일을 적용한다.
  return (
    <Avatar aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      {/* 외부 이미지 요청 시 참조 주소를 전달하지 않는다. */}
      <AvatarImage
        src={image ?? undefined}
        alt=""
        referrerPolicy="no-referrer"
        className="object-cover"
      />
      {/* 이미지가 없거나 로딩에 실패하면 닉네임 첫 글자를 표시한다. */}
      <AvatarFallback className="text-base font-medium text-foreground">
        {first}
      </AvatarFallback>
    </Avatar>
  );
}
