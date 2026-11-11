"use client";

import { useId, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { ko } from "react-day-picker/locale";
import { Button } from "@/shared/ui/button";
import { Calendar } from "@/shared/ui/calendar";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { validateFilters } from "./model";
import type { ListFilter, ListFilterValues } from "./model";

type ListFiltersProps = {
  filters: readonly ListFilter[];
  value?: ListFilterValues;
  onApply: (value: ListFilterValues) => void;
  resetLabel?: string;
};

const emptyValues: ListFilterValues = {};

/**
 * 설정에 따라 날짜 범위, 숫자 범위와 다중 선택을 구성한다.
 * @param props.filters 각 필터의 고유 ID와 라벨, 다중 선택 옵션 또는 숫자 단위를 지정한다.
 * @param props.onApply 적용 시 검증된 조건을 전달한다. 초기화 시에는 빈 객체를 전달한다.
 */
export function ListFilters({ filters, value = emptyValues, onApply, resetLabel = "초기화" }: ListFiltersProps) {
  if (!filters.length) return null;

  // 적용값이 바뀌면 이전 화면에서 편집 중이던 조건과 오류를 함께 초기화한다.
  return <FilterForm key={JSON.stringify(value)} filters={filters} value={value} onApply={onApply} resetLabel={resetLabel} />;
}

/** 적용 전 필터 입력을 보관하고, 검증 오류가 없을 때만 목록에 적용할 값을 전달한다. */
function FilterForm({ filters, value, onApply, resetLabel }: Required<ListFiltersProps>) {
  const id = useId();
  const [draft, setDraft] = useState<Parameters<typeof validateFilters>[1]>(value);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update(filterId: string, value: typeof draft[string]) {
    setDraft((current) => ({ ...current, [filterId]: value }));
    setErrors((current) => {
      if (!Object.hasOwn(current, filterId)) return current;
      const next = { ...current };
      delete next[filterId];
      return next;
    });
  }

  return (
    <form
      aria-label="목록 필터"
      className="flex flex-wrap items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const result = validateFilters(filters, draft);
        setErrors(result.errors);
        if (!Object.keys(result.errors).length) onApply(result.values);
      }}
    >
      {filters.map((filter, index) => {
        const fieldId = `${id}-${index}`;
        const error = Object.hasOwn(errors, filter.id) ? errors[filter.id] : undefined;
        const errorId = error ? `${fieldId}-error` : undefined;
        const value = Object.hasOwn(draft, filter.id) ? draft[filter.id] : undefined;
        const range = value && !("length" in value) ? value : {};

        return (
          <fieldset key={filter.id} className="grid min-w-0 gap-1.5" aria-describedby={errorId}>
            <legend className="mb-1.5 text-sm font-medium">{filter.label}</legend>
            {filter.type === "multi-select" ? (
              <MultiSelectFilter filter={filter} selected={Array.isArray(value) ? value : []} onChange={(next) => update(filter.id, next)} />
            ) : filter.type === "date-range" ? (
              <div className="flex flex-wrap gap-2">
                <DateBoundary label={`${filter.label} 시작일`} placeholder="시작일" value={String(range.from ?? "")} errorId={errorId} onChange={(from) => update(filter.id, { ...range, from })} />
                <DateBoundary label={`${filter.label} 종료일`} placeholder="종료일" value={String(range.to ?? "")} errorId={errorId} onChange={(to) => update(filter.id, { ...range, to })} />
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="text" inputMode="decimal" className="w-24" placeholder="최솟값" aria-label={`${filter.label} 최솟값`} aria-invalid={error ? true : undefined} aria-describedby={errorId} value={range.from ?? ""} onChange={(event) => update(filter.id, { ...range, from: event.target.value })} />
                <Input type="text" inputMode="decimal" className="w-24" placeholder="최댓값" aria-label={`${filter.label} 최댓값`} aria-invalid={error ? true : undefined} aria-describedby={errorId} value={range.to ?? ""} onChange={(event) => update(filter.id, { ...range, to: event.target.value })} />
                {filter.unit && <span className="text-sm text-muted-foreground">{filter.unit}</span>}
              </div>
            )}
            {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
          </fieldset>
        );
      })}
      <div className="flex gap-2 self-end">
        <Button type="submit">적용</Button>
        <Button type="button" variant="outline" onClick={() => {
          setDraft({});
          setErrors({});
          onApply({});
        }}>{resetLabel}</Button>
      </div>
    </form>
  );
}

/** 시작일과 종료일을 독립적으로 선택하거나 해제해 한쪽 날짜만으로도 필터를 구성한다. */
function DateBoundary({ label, placeholder, value, errorId, onChange }: {
  label: string;
  placeholder: string;
  value: string;
  errorId?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // 달력의 날짜를 현지 시각으로 읽어 UTC 변환으로 날짜가 바뀌지 않게 한다.
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label={value ? `${label} ${value}` : label} aria-invalid={errorId ? true : undefined} aria-describedby={errorId}>
          <CalendarDays aria-hidden="true" />
          {value || placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={label} className="w-auto p-2">
        <Calendar
          mode="single"
          locale={ko}
          autoFocus
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            const formatted = date
              ? [String(date.getFullYear()).padStart(4, "0"), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-")
              : "";
            onChange(formatted);
            setOpen(false);
          }}
        />
        {value && <Button type="button" variant="ghost" size="sm" onClick={() => {
          onChange("");
          setOpen(false);
        }}>선택 해제</Button>}
      </PopoverContent>
    </Popover>
  );
}

/** 선택 목록을 펼친 상태에서 여러 값을 토글하고 버튼에는 현재 선택 개수를 표시한다. */
function MultiSelectFilter({ filter, selected, onChange }: {
  filter: Extract<ListFilter, { type: "multi-select" }>;
  selected: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const label = selected.length ? `${filter.label} ${selected.length}개 선택` : filter.label;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={!filter.options.length}>
          {label}
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={filter.label} className="max-h-[min(16rem,var(--radix-popover-content-available-height))] p-2">
        {filter.options.map(({ value, label }) => (
          <label key={value} className="flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm hover:bg-accent">
            <Checkbox
              checked={selected.includes(value)}
              onCheckedChange={(checked) => onChange(checked === true
                ? [...selected, value]
                : selected.filter((item) => item !== value))}
            />
            <span className="min-w-0 wrap-anywhere">{label}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
