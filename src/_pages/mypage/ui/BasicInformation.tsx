"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/shared/ui/Avatar";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { toast } from "sonner";

/** 기본 정보 화면에 필요한 표시 프로필. */
type BasicInformationProps = {
  // 내부 사용자에 저장된 표시 이름.
  nickname: string;
  // 브라우저에서 읽을 수 있는 현재 이미지 주소.
  image: string | null;
  // 현재 OAuth 세션에서 인증된 이메일이며 미확인 상태면 null.
  email: string | null;
};

/**
 * 닉네임과 선택한 이미지 파일을 수정하는 반응형 기본 정보 폼을 렌더링한다.
 * @param props 최신 내부 프로필과 인증 이메일.
 * @returns 공통 아바타와 입력 컴포넌트를 사용하는 기본 정보 카드.
 */
export function BasicInformation({ nickname, image, email }: BasicInformationProps) {
  // 저장 후 서버 컴포넌트를 다시 읽어 카드와 공통 계정 메뉴를 갱신한다.
  const router = useRouter();
  // 폼 처리 상태와 다시 시도할 수 있는 오류 문구를 표시한다.
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  /**
   * 파일과 닉네임을 같은 출처의 저장 API로 전송한다.
   * @param event 기본 폼 탐색을 중단하고 입력을 읽을 폼 이벤트.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    // 입력을 데이터로 복사한 후 폼 탐색 없이 결과를 기다린다.
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    /**
     * 요청 동안 중복 제출을 막고 성공 시 최신 프로필을 다시 읽는다.
     */
    startTransition(async () => {
      try {
        // 서버가 FormData 경계를 읽을 수 있도록 브라우저가 요청 헤더를 구성한다.
        const response = await fetch("/api/auth/profile", { method: "POST", body: data });
        if (!response.ok) {
          // 서버가 안내할 수 있는 입력 오류를 폼에 연결한다.
          const result = await response.json();
          setError(typeof result.error === "string" ? result.error : "프로필을 저장하지 못했습니다.");
          return;
        }
        // 이미 저장한 파일을 다음 닉네임 수정 때 다시 올리지 않도록 선택을 초기화한다.
        const file = form.elements.namedItem("image");
        if (file instanceof HTMLInputElement) file.value = "";
        toast.success("기본 정보를 저장했습니다.");
        router.refresh();
      } catch {
        // 통신이나 응답 해석이 실패하면 폼 입력을 유지해 다시 제출할 수 있게 한다.
        setError("프로필을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  // 한 열을 기본으로 배치해 데스크톱과 모바일에서 동일한 폼을 사용한다.
  return (
    <Card>
      <CardHeader><CardTitle>기본 정보</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-5">
          {/* 현재 이미지와 지원하는 업로드 형식을 함께 표시한다. */}
          <div className="grid gap-2">
            <label htmlFor="profile-image" className="text-sm font-medium">프로필 이미지</label>
            <div className="flex min-w-0 items-center gap-3">
              <Avatar nickname={nickname} image={image} />
              <Input id="profile-image" name="image" type="file" accept="image/jpeg,image/png,image/webp"
                aria-describedby="profile-image-help" disabled={pending} />
            </div>
            <p id="profile-image-help" className="text-sm text-muted-foreground">JPEG, PNG, WebP · 최대 4 MiB</p>
          </div>
          {/* 닉네임 입력은 저장 중 잠그고 이메일은 읽기 전용으로 제공한다. */}
          <div className="grid gap-2">
            <label htmlFor="profile-nickname" className="text-sm font-medium">닉네임</label>
            <Input id="profile-nickname" name="nickname" defaultValue={nickname} required disabled={pending} />
          </div>
          <div className="grid gap-2">
            <label htmlFor="profile-email" className="text-sm font-medium">이메일</label>
            <Input id="profile-email" value={email ?? "이메일 미확인"} readOnly />
          </div>
          {/* 입력·저장 실패 원인을 읽을 수 있게 알리고 처리 중 중복 요청을 막는다. */}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="justify-self-start" disabled={pending}>{pending ? "저장 중" : "저장"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
