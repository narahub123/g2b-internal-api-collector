"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import type { ListOption } from "./model";

/**
 * 호출부가 제공한 정렬 기준과 방향을 한 옵션으로 표시하고, 선택 즉시 옵션 ID를 전달한다.
 * @param props.value 현재 적용된 정렬 옵션 ID. options에 포함된 값을 지정한다.
 */
export function ListSort({ options, value, onChange }: {
  options: readonly ListOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (!options.length) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="정렬"><SelectValue placeholder="정렬 선택" /></SelectTrigger>
      <SelectContent>
        {options.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
