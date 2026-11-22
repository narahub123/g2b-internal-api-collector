import { withDownloadAccess } from "@/server/auth/business-access";
import { downloadBaseAmountAdjustment } from "@/features/download-g2b-attachment/server/base-amount-adjustment-handler";

// 로그인한 사용자에게만 저장된 첨부의 다운로드를 허용한다.
export const GET = withDownloadAccess(downloadBaseAmountAdjustment);
