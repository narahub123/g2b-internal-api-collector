"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

type Disclosure = { id: string; open: boolean; toggle: () => void };
const DisclosureContext = createContext<Disclosure | null>(null);

/** 한 공고의 표에 있는 모든 조회 버튼과 표 아래 상세 영역의 열림 상태를 공유한다. */
export function BaseAmountDisclosure({ children }: { children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <DisclosureContext.Provider value={{ id, open, toggle: () => setOpen((value) => !value) }}>
      {children}
    </DisclosureContext.Provider>
  );
}

/** 연결된 기초금액 상세를 토글하고 현재 상태를 보조 기술에 전달한다. */
export function BaseAmountButton() {
  const disclosure = useContext(DisclosureContext);
  if (!disclosure) return null;
  return (
    <button
      type="button"
      aria-expanded={disclosure.open}
      aria-controls={disclosure.id}
      onClick={disclosure.toggle}
      className="cursor-pointer whitespace-nowrap rounded border px-3 py-1 text-primary hover:bg-accent"
    >
      기초금액조회
    </button>
  );
}

/** 표 아래의 단일 영역을 토글 대상에 연결하며 내부 공지의 열린 상태를 유지한다. */
export function BaseAmountPanel({ children }: { children: ReactNode }) {
  const disclosure = useContext(DisclosureContext);
  if (!disclosure) return null;
  return (
    <section
      id={disclosure.id}
      hidden={!disclosure.open}
      aria-label="기초금액 상세"
      className="mt-4 min-w-0"
    >
      {children}
    </section>
  );
}

/** 원본 안내 영역과 같이 76px를 넘는 안내에서만 전체 내용을 펼칠 수 있게 한다. */
export function BaseAmountHelp({ children }: { children: ReactNode }) {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setOverflows(element.scrollHeight > 76));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <div id={id} className={overflows && !open ? "max-h-[76px] overflow-hidden" : undefined}>
        <div ref={content}>{children}</div>
      </div>
      {overflows && (
        <button
          type="button"
          className="mt-1 cursor-pointer text-primary underline"
          aria-controls={id}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "유의사항 접기" : "유의사항 더 보기"}
        </button>
      )}
    </div>
  );
}
