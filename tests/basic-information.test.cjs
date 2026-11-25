const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// 기본 정보 컴포넌트의 실제 구현을 검증 대상으로 사용한다.
const source = readFileSync(
  join(__dirname, "../src/_pages/mypage/ui/BasicInformation.tsx"),
  "utf8",
);

/** 변경 사항이 없는 경우 저장 버튼과 저장 요청이 제한되는지 확인한다. */
test("기본 정보의 변경 사항이 없으면 저장을 제한한다", () => {
  assert.match(
    source,
    /nicknameValue\.trim\(\)\s*!==\s*savedNickname\s*\|\|\s*selectedImage\s*!==\s*null/,
  );
  assert.match(source, /disabled=\{pending\s*\|\|\s*!isChanged\}/);
  assert.match(source, /if\s*\(pending\s*\|\|\s*!isChanged\)\s*return;/);
});

/** 프로필 이미지에서 숨겨진 파일 입력을 실행하는지 확인한다. */
test("프로필 이미지 클릭 시 파일 선택 창을 실행한다", () => {
  assert.match(source, /fileInputRef\.current\?\.click\(\)/);
  assert.match(source, /onClick=\{openFilePicker\}/);
  assert.match(
    source,
    /<input\b[^>]*ref=\{fileInputRef\}[^>]*type="file"[^>]*\bhidden\b/,
  );
});

/** 미리보기 확인 전에는 저장할 이미지가 변경되지 않는지 확인한다. */
test("선택한 이미지는 미리보기 확인 후 저장 대상으로 반영한다", () => {
  assert.match(source, /setCandidateImage\(\{\s*file,\s*url\s*\}\)/);
  assert.match(source, /open=\{candidateImage\s*!==\s*null\}/);
  assert.match(
    source,
    /function confirmImage\(\)\s*\{[\s\S]*?setSelectedImage\(candidateImage\);[\s\S]*?setCandidateImage\(null\);/,
  );
});

/** 미리보기를 취소해도 기존에 확정한 이미지를 유지하는지 확인한다. */
test("미리보기 취소 시 확인하지 않은 이미지만 제거한다", () => {
  const handler = source.match(
    /function handlePreviewOpenChange\(open:\s*boolean\)\s*\{([\s\S]*?)\n {2}\}/,
  );

  assert.ok(handler);
  assert.match(handler[1], /setCandidateImage\(null\)/);
  assert.doesNotMatch(handler[1], /setSelectedImage/);
});

/** 확인한 이미지 파일만 기존 저장 요청에 포함하는지 확인한다. */
test("확정한 이미지와 닉네임을 기존 프로필 API로 전송한다", () => {
  assert.match(source, /new FormData\(form\)/);
  assert.match(source, /name="nickname"/);
  assert.match(
    source,
    /if\s*\(selectedImage\)\s*\{\s*data\.set\("image",\s*selectedImage\.file\);/,
  );
  assert.match(
    source,
    /fetch\(\s*"\/api\/auth\/profile",\s*\{\s*method:\s*"POST",\s*body:\s*data,?\s*\}/,
  );
});

/** 저장 성공 후 변경 여부의 비교 기준과 이미지 선택 상태를 갱신하는지 확인한다. */
test("저장 성공 후 변경 상태를 초기화한다", () => {
  assert.match(source, /setSavedNickname\(nicknameValue\.trim\(\)\)/);
  assert.match(source, /setNicknameValue\(nicknameValue\.trim\(\)\)/);
  assert.match(
    source,
    /setSelectedImage\(null\);\s*setCandidateImage\(null\);/,
  );
  assert.match(source, /router\.refresh\(\)/);
});

/** 이메일은 수정할 수 없으며 저장 요청의 입력 대상에서 제외되는지 확인한다. */
test("이메일은 읽기 전용으로 표시한다", () => {
  const input = source.match(/<Input\b[^>]*id="profile-email"[^>]*\/>/);

  assert.ok(input);
  assert.match(input[0], /\breadOnly\b/);
  assert.match(input[0], /className="bg-muted"/);
  assert.doesNotMatch(input[0], /\bname=/);
});

/** 모바일과 PC의 저장 버튼 너비 설정을 유지하는지 확인한다. */
test("모바일에서는 저장 버튼을 전체 너비로 표시한다", () => {
  assert.match(source, /className="w-full sm:w-auto sm:justify-self-end"/);
});
