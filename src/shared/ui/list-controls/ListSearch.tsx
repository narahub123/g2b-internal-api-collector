"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import type { ListOption, ListSearchValue } from "./model";

type ListSearchProps = {
  fields: readonly ListOption[];
  defaultField: string;
  value?: ListSearchValue;
  onSubmit: (value: ListSearchValue) => void;
};

/**
 * 검색 대상을 하나 선택하고 버튼 또는 Enter로 검색어를 제출한다.
 * @param props.defaultField 적용값이 없을 때 사용할 검색 대상 ID. 등록된 대상 중 하나를 지정한다.
 * @param props.onSubmit 공백을 정리한 검색 조건을 받는다. 빈 검색어는 검색 조건 해제를 의미한다.
 */
export function ListSearch(props: ListSearchProps) {
  const { fields, defaultField, value } = props;
  if (!fields.length) return null;
  const requestedField = value?.field ?? defaultField;
  const field = fields.some((item) => item.value === requestedField) ? requestedField : fields[0].value;
  const applied = { field, query: value?.query ?? "" };

  // URL 이동 등으로 적용값이 바뀌면 편집값도 새 조건을 기준으로 시작한다.
  return <SearchForm key={JSON.stringify(applied)} fields={fields} value={applied} onSubmit={props.onSubmit} />;
}

/** 적용된 검색 조건을 바탕으로 입력값을 편집하고 제출 시에만 호출부에 전달한다. */
function SearchForm({ fields, value, onSubmit }: {
  fields: readonly ListOption[];
  value: ListSearchValue;
  onSubmit: ListSearchProps["onSubmit"];
}) {
  const [field, setField] = useState(value.field);
  const [query, setQuery] = useState(value.query);

  return (
    <form
      role="search"
      aria-label="목록 검색"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ field, query: query.trim() });
      }}
    >
      <Select value={field} onValueChange={setField}>
        <SelectTrigger aria-label="검색 대상"><SelectValue /></SelectTrigger>
        <SelectContent>
          {fields.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input aria-label="검색어" placeholder="검색어 입력" type="search" className="min-w-28 flex-1" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Button type="submit">검색</Button>
    </form>
  );
}
