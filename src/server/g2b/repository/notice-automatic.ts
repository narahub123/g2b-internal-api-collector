import {
  noticeAutomaticIntervals, noticeKoreanMinute,
  type NoticeAutomaticCommand, type NoticeAutomaticInterval, type NoticeAutomaticSettings,
} from "@/features/collect-g2b/model/notice-automatic";
import type { G2bDatabase } from "./database";

type Schedule = {
  enabled: number;
  interval: NoticeAutomaticInterval;
  startMinute: string | null;
  nextAt: number | null;
  generation: number;
  immediate: number;
  maintenance: number;
  manual: number;
};

function startTime(minute: string) {
  return Date.parse(`${minute}:00+09:00`);
}

function nextTime(anchor: number, interval: NoticeAutomaticInterval, now: number) {
  const period = interval * 60_000;
  return anchor + (Math.floor((now - anchor) / period) + 1) * period;
}

// 이전 세대의 보류 공고는 재개 후 처리하되 현재 일정의 완료 기준에서 제외한다.
const unfinished = "phase IN ('pending', 'discovering', 'collecting') AND coveredThrough IS NULL";

/** 자동 수집 설정과 회차 등록을 같은 Turso 연결에서 처리한다. */
export function openNoticeAutomatic(db: G2bDatabase) {
  async function read() {
    return await db.prepare(`
      SELECT a.*, q.maintenance, q.manual FROM g2b_notice_automatic a JOIN g2b_notice_queue q ON q.id = a.id WHERE a.id = 1
    `).get() as Schedule;
  }

  return {
    /** 접수 대기와 실제 선점 상태를 구분하고 이전 일정에서 보류된 자동 공고도 포함한다. */
    async get(): Promise<NoticeAutomaticSettings> {
      return db.transaction(async () => {
        const { enabled, interval, startMinute, nextAt, generation, immediate, maintenance, manual } = await read();
        const work = await db.prepare(`
          SELECT
            (EXISTS (SELECT 1 FROM g2b_notice_runs WHERE scheduleGeneration = ? AND phase = 'discovering')
             OR EXISTS (SELECT 1 FROM g2b_notice_jobs WHERE source = 'automatic' AND status = 'running')) AS running,
            (EXISTS (SELECT 1 FROM g2b_notice_runs WHERE scheduleGeneration = ? AND ${unfinished})
             OR EXISTS (SELECT 1 FROM g2b_notice_jobs WHERE source = 'automatic' AND status IN ('pending', 'retry_wait'))) AS pending
        `).get(generation, generation);
        let status: NoticeAutomaticSettings["status"];
        if (!enabled) status = work?.running ? "stopping" : "stopped";
        else if (work?.running) status = "running";
        else if (maintenance) status = "maintenance";
        else if (manual) status = "queue_paused";
        else status = immediate || work?.pending ? "pending" : "scheduled";
        return {
          enabled: Boolean(enabled), interval, startMinute, nextAt, status,
        };
      }, false);
    },

    /**
     * 시작·재개를 접수하거나 일정 설정을 갱신한다. 중단 요청의 적용은 다음 큐 선점부터 보장한다.
     * @throws 이미 실행 중인 일정에 시작을 요청하거나 시작 시각·주기가 올바르지 않으면 RangeError.
     */
    update(command: NoticeAutomaticCommand, now = Date.now()) {
      return db.transaction(async () => {
        const schedule = await read();
        if (command.action === "stop") {
          await db.prepare("UPDATE g2b_notice_automatic SET enabled = 0, immediate = 0, nextAt = NULL WHERE id = 1").run();
          // 목록 탐색은 아직 공고를 접수하지 않았으므로 중단 중 반환된 응답은 반영하지 않는다.
          await db.prepare(`UPDATE g2b_notice_runs SET phase = 'pending'
            WHERE scheduleGeneration = ? AND phase = 'discovering'`).run(schedule.generation);
          return;
        }

        if (!noticeAutomaticIntervals.includes(command.interval)) throw new RangeError("수집 주기를 확인해 주세요.");
        if (command.action === "interval") {
          const nextAt = schedule.enabled && schedule.startMinute
            ? nextTime(startTime(schedule.startMinute), command.interval, now) : null;
          await db.prepare("UPDATE g2b_notice_automatic SET interval = ?, nextAt = ? WHERE id = 1").run(command.interval, nextAt);
          return;
        }

        const anchor = startTime(command.startMinute);
        if (!Number.isFinite(anchor) || noticeKoreanMinute(anchor) !== command.startMinute || anchor > now) {
          throw new RangeError("시작 시각은 현재까지의 올바른 한국 시각을 입력해 주세요.");
        }
        if (schedule.enabled) throw new RangeError("자동 수집을 중단한 뒤 시작 시각을 지정해 주세요.");
        // 이전 목록 접수는 새 시작 시각으로 대체하되 이미 큐에 저장된 공고는 유지한다.
        await db.prepare(`UPDATE g2b_notice_runs SET phase = 'failed', error = '새 시작 시각으로 재개했습니다.'
          WHERE scheduleGeneration IS NOT NULL AND phase IN ('pending', 'discovering')`).run();
        await db.prepare(`UPDATE g2b_notice_automatic
          SET enabled = 1, immediate = 1, generation = generation + 1, startMinute = ?, interval = ?, nextAt = ?
          WHERE id = 1`).run(command.startMinute, command.interval, nextTime(anchor, command.interval, now));
      });
    },

    /**
     * 실행할 시점이면 현재 세대의 다음 구간을 접수한다. 이미 실행 중인 정기 회차는 건너뛴다.
     * @returns 정기 시각에 점검 중일 때만 정상 복귀 확인에 필요한 점검·일정 세대를 반환한다.
     */
    async tick(now = Date.now()): Promise<{ maintenance: number; generation: number } | undefined> {
      const due = ({ nextAt }: Schedule) => nextAt !== null && now >= nextAt;
      const ready = (schedule: Schedule) => schedule.enabled && (schedule.immediate || due(schedule));
      if (!ready(await read())) return;
      return db.transaction(async () => {
        const schedule = await read();
        const { startMinute, generation, interval, maintenance, nextAt } = schedule;
        if (!startMinute || !ready(schedule)) return;
        const regular = due(schedule);
        const following = regular ? nextTime(startTime(startMinute), interval, now) : nextAt;
        await db.prepare("UPDATE g2b_notice_automatic SET immediate = 0, nextAt = ? WHERE id = 1")
          .run(following);
        // 워커가 공고 종료 직후 회차를 확인한 경우에도 정기 시각에 실행 중이었다면 그 회차는 건너뛴다.
        const slot = regular && following !== null ? following - interval * 60_000 : null;
        const active = await db.prepare(`
          SELECT 1 FROM g2b_notice_runs WHERE scheduleGeneration = ?
          AND ((${unfinished}) OR scheduleFinishedAt > ?) LIMIT 1
        `).get(generation, slot);
        if (!active) {
          const row = await db.prepare("SELECT MAX(coveredThrough) AS end FROM g2b_notice_runs WHERE scheduleGeneration = ?").get(generation);
          const from = typeof row?.end === "string" ? row.end : startMinute;
          await db.prepare(`INSERT INTO g2b_notice_runs (startMinute, endMinute, source, scheduleGeneration)
            VALUES (?, ?, 'automatic', ?)`).run(from, noticeKoreanMinute(now), generation);
        }
        if (regular && maintenance) {
          // 점검 중 목록을 확정하지 못한 구간은 정상 여부를 다시 확인할 때까지 조회 범위를 확장한다.
          await db.prepare(`UPDATE g2b_notice_runs SET endMinute = MAX(endMinute, ?)
            WHERE scheduleGeneration = ? AND phase = 'pending'`).run(noticeKoreanMinute(now), generation);
          return { maintenance, generation };
        }
      });
    },
  };
}
