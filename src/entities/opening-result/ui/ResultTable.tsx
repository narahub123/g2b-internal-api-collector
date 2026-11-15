import type { ReactNode } from "react";
import { decodeHTMLStrict } from "entities";
import type { DisplayTable } from "../model/opening-result-display";

/**
 * API 응답값을 화면에 표시할 문자열로 변환한다.
 * 문자열은 HTML 엔티티를 해제하고, 빈 값은 빈 문자열로 유지한다.
 * @param value 표시할 원본 값.
 * @returns 화면에 표시할 문자열.
 */
export function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return decodeHTMLStrict(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

/**
 * 개찰결과와 부가 조회 결과의 표를 공통 렌더링한다.
 * 행 또는 표시 가능한 열이 없으면 빈 표 대신 해당 사유를 안내한다.
 * @param props 열·행과 선택적 셀 콘텐츠 및 행 선택 동작.
 */
export function ResultTable({ table, renderCell, onRowClick }: {
  table: DisplayTable;
  renderCell?: (key: string, rowIndex: number) => ReactNode;
  onRowClick?: (rowIndex: number) => void;
}) {
  if (!table.rows.length)
    return (
      <p className="text-sm text-muted-foreground">조회된 목록이 없습니다.</p>
    );
  if (!table.columns.length)
    return (
      <p className="text-sm text-muted-foreground">
        표시할 수 있는 목록 항목이 없습니다.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary">
          <tr>
            {table.columns.map(({ key, label }) => (
              <th key={key} scope="col" className="whitespace-nowrap px-3 py-2">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="border-t align-top" onClick={onRowClick && (() => onRowClick(index))}>
              {table.columns.map(({ key }) => (
                <td
                  key={key}
                  className="min-w-20 whitespace-pre-wrap px-3 py-2"
                >
                  {renderCell?.(key, index) ?? display(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
