"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
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

/** 선택한 이미지 파일과 브라우저 미리보기 정보. */
type ProfileImageSelection = {
  // 저장 요청에 포함할 원본 이미지 파일.
  file: File;
  // 서버에 업로드하기 전에 이미지를 표시할 브라우저 임시 주소.
  url: string;
};
/**
 * 닉네임과 선택한 이미지 파일을 수정하는 반응형 기본 정보 폼을 렌더링한다.
 * @param props 최신 내부 프로필과 인증 이메일.
 * @returns 공통 아바타와 입력 컴포넌트를 사용하는 기본 정보 카드.
 */
export function BasicInformation({
  nickname,
  image,
  email,
}: BasicInformationProps) {
  // 저장 후 서버 컴포넌트를 다시 읽어 카드와 공통 계정 메뉴를 갱신한다.
  const router = useRouter();
  // 프로필 이미지 클릭 시 숨겨진 파일 입력을 실행한다.
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 저장할 이미지와 미리보기에서 확인 중인 이미지를 구분한다.
  const [selectedImage, setSelectedImage] =
    useState<ProfileImageSelection | null>(null);
  const [candidateImage, setCandidateImage] =
    useState<ProfileImageSelection | null>(null);
  // 생성한 미리보기 주소를 관리한다.
  const objectUrls = useRef(new Set<string>());
  // 닉네임 입력값과 마지막으로 저장된 닉네임을 관리한다.
  const [nicknameValue, setNicknameValue] = useState(nickname);
  const [savedNickname, setSavedNickname] = useState(nickname);
  // 실제 변경 사항이 있을 때만 저장할 수 있도록 한다.
  const isChanged =
    nicknameValue.trim() !== savedNickname || selectedImage !== null;
  // 폼 처리 상태와 다시 시도할 수 있는 오류 문구를 표시한다.
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // 더 이상 사용하지 않는 미리보기 주소를 해제한다.
  useEffect(() => {
    for (const url of objectUrls.current) {
      if (url !== selectedImage?.url && url !== candidateImage?.url) {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(url);
      }
    }
  }, [selectedImage, candidateImage]);

  // 화면을 벗어나면 남아 있는 미리보기 주소를 정리한다.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  /**
   * 운영체제의 기본 파일 선택 창을 연다.
   */
  function openFilePicker() {
    fileInputRef.current?.click();
  }

  /**
   * 선택한 이미지 파일을 검증하고 미리보기를 준비한다.
   * @param event 이미지 파일 선택 이벤트.
   */
  function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // 동일한 파일을 다시 선택할 수 있도록 입력값을 초기화한다.
    event.currentTarget.value = "";

    // 파일 선택을 취소한 경우 기존 이미지 선택 상태를 유지한다.
    if (!file) return;

    // 기존 서버 업로드 조건에 맞는 이미지인지 확인한다.
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("JPEG, PNG, WebP 이미지만 선택할 수 있습니다.");
      return;
    }

    // 서버의 최대 업로드 용량을 초과하는 파일은 미리보기 전에 제외한다.
    if (file.size > 4 * 1024 * 1024) {
      toast.error("이미지는 최대 4 MiB까지 선택할 수 있습니다.");
      return;
    }

    // 서버에 업로드하지 않고 브라우저 미리보기 주소를 생성한다.
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    setCandidateImage({ file, url });
  }

  /**
   * 미리보기에서 확인한 이미지를 기본 정보 화면에 반영한다.
   */
  function confirmImage() {
    // 확인할 이미지가 없는 경우 기존 선택 상태를 변경하지 않는다.
    if (!candidateImage) return;
    // 실제 저장은 기본 정보 폼을 제출할 때 진행한다.
    setSelectedImage(candidateImage);
    setCandidateImage(null);
  }

  /**
   * 미리보기를 닫고 확인하지 않은 이미지 선택을 취소한다.
   * @param open Dialog 표시 여부.
   */
  function handlePreviewOpenChange(open: boolean) {
    // 미리보기만 취소하고 이전에 확정한 이미지 선택은 유지한다.
    if (!open) {
      setCandidateImage(null);
    }
  }

  /**
   * 파일과 닉네임을 같은 출처의 저장 API로 전송한다.
   * @param event 기본 폼 탐색을 중단하고 입력을 읽을 폼 이벤트.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    // 입력을 데이터로 복사한 후 폼 탐색 없이 결과를 기다린다.
    event.preventDefault();
    // 변경 사항이 없거나 저장 중이면 추가 요청을 보내지 않는다.
    if (pending || !isChanged) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    // 미리보기에서 확인한 이미지 파일만 저장 요청에 포함한다.
    if (selectedImage) {
      data.set("image", selectedImage.file);
    }
    setError("");
    /**
     * 요청 동안 중복 제출을 막고 성공 시 최신 프로필을 다시 읽는다.
     */
    startTransition(async () => {
      try {
        // 서버가 FormData 경계를 읽을 수 있도록 브라우저가 요청 헤더를 구성한다.
        const response = await fetch("/api/auth/profile", {
          method: "POST",
          body: data,
        });
        if (!response.ok) {
          // 서버가 안내할 수 있는 입력 오류를 폼에 연결한다.
          const result = await response.json();
          setError(
            typeof result.error === "string"
              ? result.error
              : "프로필을 저장하지 못했습니다.",
          );
          return;
        }
        // 저장된 닉네임을 변경 여부의 새로운 비교 기준으로 사용한다.
        setSavedNickname(nicknameValue.trim());
        setNicknameValue(nicknameValue.trim());
        // 이미 저장한 파일을 다음 닉네임 수정 때 다시 올리지 않도록 선택을 초기화한다.
        setSelectedImage(null);
        setCandidateImage(null);
        toast.success("기본 정보를 저장했습니다.");
        router.refresh();
      } catch {
        // 통신이나 응답 해석이 실패하면 폼 입력을 유지해 다시 제출할 수 있게 한다.
        setError("프로필을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  // PC에서는 가로로, 모바일에서는 세로로 기본 정보를 배치한다.
  return (
    <Card>
      <CardHeader>
        <CardTitle>기본 정보</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-5">
          <div className="flex flex-col items-center gap-6 sm:flex-row">
            {/* 이미지 클릭 시 운영체제의 파일 선택 창을 바로 연다. */}
            <button
              type="button"
              aria-label="프로필 이미지 변경"
              className="group relative size-20 shrink-0 cursor-pointer overflow-hidden rounded-full disabled:cursor-not-allowed"
              onClick={openFilePicker}
              disabled={pending}
            >
              <UserAvatar
                nickname={nickname}
                image={selectedImage?.url ?? image}
                className="size-full"
              />
              {/* Hover 또는 키보드 포커스 시 카메라 아이콘을 표시한다. */}
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                <Camera className="size-7" />
              </span>
            </button>
            {/* 파일 선택 요소는 화면에 표시하지 않는다. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageSelect}
              disabled={pending}
              hidden
            />
            {/* 닉네임 입력은 저장 중 잠그고 이메일은 읽기 전용으로 제공한다. */}
            <div className="grid w-full min-w-0 flex-1 gap-3">
              <Input
                id="profile-nickname"
                name="nickname"
                aria-label="닉네임"
                placeholder="닉네임"
                value={nicknameValue}
                onChange={(event) => setNicknameValue(event.target.value)}
                required
                disabled={pending}
              />
              <Input
                id="profile-email"
                aria-label="이메일"
                value={email ?? "이메일 미확인"}
                className="bg-muted"
                readOnly
              />
            </div>
          </div>
          {/* 입력·저장 실패 원인을 읽을 수 있게 알리고 처리 중 중복 요청을 막는다. */}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full sm:w-auto sm:justify-self-end"
            disabled={pending || !isChanged}
          >
            {pending ? "저장 중" : "저장"}
          </Button>
        </form>
        {/* 파일 선택이 완료된 이후에만 미리보기를 표시한다. */}
        <Dialog
          open={candidateImage !== null}
          onOpenChange={handlePreviewOpenChange}
        >
          <DialogContent>
            <div className="grid gap-2">
              <DialogTitle>프로필 이미지 미리보기</DialogTitle>
              <DialogDescription>
                선택한 이미지를 확인해 주세요.
              </DialogDescription>
            </div>
            {/* 실제 프로필에 표시될 원형 이미지 형태를 제공한다. */}
            <div className="flex justify-center py-6">
              <UserAvatar
                nickname={nickname}
                image={candidateImage?.url ?? null}
                className="size-48"
              />
            </div>
            {/* 이미지 선택을 취소하거나 확정한다. */}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handlePreviewOpenChange(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                onClick={confirmImage}
                disabled={!candidateImage}
              >
                확인
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
