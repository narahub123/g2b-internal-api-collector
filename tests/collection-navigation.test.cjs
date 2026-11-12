const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");

const filename = require.resolve("../src/_pages/admin/g2b/ui/CollectionForm.tsx");
const { code } = transformSync(readFileSync(filename, "utf8"), {
  filename,
  jsc: {
    parser: { syntax: "typescript", tsx: true },
    transform: { react: { runtime: "automatic" } },
  },
  module: { type: "commonjs" },
});

function renderCollectionForm(refreshCollectionNavigation, push) {
  const dependencies = {
    "react/jsx-runtime": { jsx: (_component, props) => props },
    "next/navigation": { useRouter: () => ({ push }) },
    "@/features/collect-g2b": { CollectG2bForm: () => null },
    "../../config/routes": {
      collectionDetailPaths: { "order-plans": ({ number }) => `/admin/g2b/order-plans/${number}` },
    },
    "../actions/refresh-collection-navigation": { refreshCollectionNavigation },
  };
  const exports = {};
  new Function("require", "exports", code)((id) => dependencies[id], exports);
  return exports.CollectionForm({ section: "order-plans" });
}

test("목록 갱신이 끝난 뒤 수집한 자료의 상세로 이동한다", async () => {
  const refresh = Promise.withResolvers();
  const calls = [];
  const form = renderCollectionForm(() => {
    calls.push("refresh");
    return refresh.promise;
  }, (url) => calls.push(url));

  const completed = form.onCollected({ number: "R26TEST", revision: "" });
  assert.deepEqual(calls, ["refresh"]);
  refresh.resolve();
  await completed;
  assert.deepEqual(calls, ["refresh", "/admin/g2b/order-plans/R26TEST"]);
});

test("목록 갱신이 실패하면 상세로 이동하지 않고 오류를 수집 폼에 전달한다", async () => {
  const error = new Error("갱신 실패");
  const form = renderCollectionForm(async () => {
    throw error;
  }, () => assert.fail("갱신 실패 후 상세로 이동함"));

  await assert.rejects(() => form.onCollected({ number: "R26TEST", revision: "" }), error);
});
