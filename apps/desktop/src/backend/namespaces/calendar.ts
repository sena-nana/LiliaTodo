// AB-01：backend.calendar 命名空间——周排期与日历冲突解决（基于服务端 Agent）。
// 一期 noop；UI 入口按 capabilities.has("calendar") 决定可见性。

import { BackendDisabledError } from "../errors";

export interface BackendCalendar {
  planWeek(): Promise<{ intentId: string }>;
  resolveConflict(eventIds: string[]): Promise<{ intentId: string }>;
}

export const noopBackendCalendar: BackendCalendar = {
  async planWeek() {
    throw new BackendDisabledError("calendar.planWeek");
  },
  async resolveConflict() {
    throw new BackendDisabledError("calendar.resolveConflict");
  },
};
