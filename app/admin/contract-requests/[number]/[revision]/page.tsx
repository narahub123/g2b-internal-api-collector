import Link from "next/link";
import { notFound } from "next/navigation";
import {
  contractRequestApiPath,
  contractRequestRevision,
  type ContractRequestKey,
} from "@/entities/contract-request/model/contract-request";
import { ContractRequestDetail } from "@/entities/contract-request/ui/ContractRequestDetail";
import { getNoticeRepository } from "@/entities/notice/server";
import { g2bNumber } from "@/shared/model/g2b-number";
import { Button } from "@/shared/ui/button";
import { RecollectButton } from "@/shared/ui/recollect-button";

export default async function Page({
  params,
}: {
  params: Promise<ContractRequestKey>;
}) {
  const key = await params;
  if (
    g2bNumber(key.number) !== key.number ||
    contractRequestRevision(key.revision) !== key.revision
  )
    notFound();
  const contractRequest = getNoticeRepository().findContractRequest(key);

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href="/admin">목록으로 돌아가기</Link>
      </Button>
      <h1 className="sr-only">계약요청</h1>
      {contractRequest ? (
        <ContractRequestDetail contractRequest={contractRequest} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            계약요청 {key.number} / {key.revision}의 상세를 아직 수집하지
            않았습니다.
          </p>
          <RecollectButton endpoint={contractRequestApiPath(key)} initial />
        </div>
      )}
    </main>
  );
}
