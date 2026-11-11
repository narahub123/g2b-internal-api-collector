const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { transformSync } = require("next/dist/build/swc");

// CommonJS 프로젝트에서 앱과 같은 SWC 변환으로 TypeScript 모듈을 읽는다.
const filename = require.resolve("../src/shared/ui/list-controls/model.ts");
const { code } = transformSync(readFileSync(filename, "utf8"), {
  filename,
  jsc: { parser: { syntax: "typescript" } },
  module: { type: "commonjs" },
});
const controls = {};
new Function("exports", code)(controls);
const { getPageNumbers, validateFilters } = controls;

test("페이지 번호는 최대 다섯 개이며 양 끝에서 범위가 밀린다", () => {
  assert.deepEqual(getPageNumbers(1, 0), []);
  assert.deepEqual(getPageNumbers(1, 1), [1]);
  assert.deepEqual(getPageNumbers(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(getPageNumbers(4, 6), [2, 3, 4, 5, 6]);
  assert.deepEqual(getPageNumbers(1, 12), [1, 2, 3, 4, 5]);
  assert.deepEqual(getPageNumbers(7, 12), [5, 6, 7, 8, 9]);
  assert.deepEqual(getPageNumbers(12, 12), [8, 9, 10, 11, 12]);
});

const filters = [
  { id: "date", label: "날짜", type: "date-range" },
  { id: "amount", label: "금액", type: "number-range" },
  { id: "kind", label: "분류", type: "multi-select", options: [
    { value: "a", label: "A" }, { value: "b", label: "B" },
  ] },
];

test("한쪽 범위, 0, 다중 선택은 유지하고 빈 필터는 생략한다", () => {
  assert.deepEqual(validateFilters(filters, {
    date: { to: "2024-02-29" },
    amount: { from: "0" },
    kind: ["a", "b"],
  }), {
    values: { date: { to: "2024-02-29" }, amount: { from: 0 }, kind: ["a", "b"] },
    errors: {},
  });
  assert.deepEqual(validateFilters(filters, { amount: {}, kind: [] }), { values: {}, errors: {} });
  assert.deepEqual(validateFilters(filters, { amount: { from: "0", to: "0" } }).values,
    { amount: { from: 0, to: 0 } });
});

test("존재하지 않는 날짜, 역전된 범위와 유효하지 않은 숫자를 거부한다", () => {
  for (const date of [{ from: "2025-02-29" }, { from: "2025-03-01", to: "2025-02-28" }]) {
    assert.ok(validateFilters(filters, { date }).errors.date);
  }
  for (const amount of [{ to: "Infinity" }, { to: "0x10" }, { from: "5", to: "0" }]) {
    assert.ok(validateFilters(filters, { amount }).errors.amount);
  }
});
