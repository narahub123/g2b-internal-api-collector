"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "@/shared/lib/utils";

/**
 * 사용자 이미지와 대체 표시를 포함하는 아바타 영역을 렌더링한다.
 * @param props 아바타 크기, 추가 스타일 및 Radix UI Root 속성.
 * @returns 원형 아바타 컨테이너.
 */
function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg";
}) {
  // 크기별 기본 스타일을 제공하고 사용처에서 추가 스타일을 적용할 수 있도록 한다.
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 아바타 영역에 프로필 이미지를 표시한다.
 * @param props 이미지 주소, 추가 스타일 및 Radix UI Image 속성.
 * @returns 프로필 이미지 요소.
 */
function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  // 이미지가 아바타 영역 전체를 채우도록 기본 크기를 지정한다.
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  );
}

/**
 * 프로필 이미지가 없거나 로딩되지 않았을 때 대체 콘텐츠를 표시한다.
 * @param props 대체 콘텐츠, 추가 스타일 및 Radix UI Fallback 속성.
 * @returns 아바타 대체 표시 요소.
 */
function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  // 아바타 크기에 맞춰 대체 콘텐츠의 글자 크기와 중앙 정렬을 적용한다.
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 아바타 위에 사용자 상태 등의 보조 정보를 표시한다.
 * @param props 배지 콘텐츠, 추가 스타일 및 span 요소 속성.
 * @returns 아바타 우측 하단에 배치되는 배지.
 */
function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  // 부모 아바타의 크기에 따라 배지와 내부 아이콘의 크기를 조절한다.
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 여러 아바타를 하나의 그룹으로 표시한다.
 * @param props 그룹 콘텐츠, 추가 스타일 및 div 요소 속성.
 * @returns 아바타 그룹 컨테이너.
 */
function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  // 아바타를 일부 겹쳐 배치하고 테두리를 적용해 개별 아바타를 구분한다.
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 아바타 그룹에서 생략된 사용자 수 등의 추가 정보를 표시한다.
 * @param props 표시할 콘텐츠, 추가 스타일 및 div 요소 속성.
 * @returns 아바타 그룹의 추가 정보 표시 요소.
 */
function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  // 그룹에 포함된 아바타 크기에 맞춰 추가 정보 영역의 크기를 조절한다.
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
};
