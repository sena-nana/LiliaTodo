import { describe, expect, it } from "vitest";
import {
  buildCalendarLoadAnalysis,
  buildScheduleSuggestions,
  buildTaskReschedulePatch,
  dateKeyToLocalDate,
  detectCalendarConflicts,
  getCalendarDays,
  getCalendarRange,
  groupTasksByCalendarDate,
} from "../src/domain/calendar";
import { taskFixture as task } from "./taskFixtures";

describe("日历领域逻辑", () => {
  it("日期键按本地日期构造，不依赖字符串 Date 解析", () => {
    const date = dateKeyToLocalDate("2026-06-12");

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(5);
    expect(date.getDate()).toBe(12);
    expect(date.getHours()).toBe(0);
    expect(() => dateKeyToLocalDate("2026/06/12")).toThrow(/非法日历日期/);
    expect(() => dateKeyToLocalDate("2026-02-31")).toThrow(/非法日历日期/);
  });

  it("周视图从周一开始并覆盖七天", () => {
    const range = getCalendarRange("week", new Date("2026-06-12T10:00:00.000Z"));
    const days = getCalendarDays("week", new Date("2026-06-12T10:00:00.000Z"));

    expect(range.start.getDay()).toBe(1);
    expect(range.end.getDay()).toBe(0);
    expect(days.map((day) => day.key)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
  });

  it("月视图固定返回六周日期", () => {
    const days = getCalendarDays("month", new Date("2026-06-12T10:00:00.000Z"));

    expect(days).toHaveLength(42);
    expect(days[0]?.key).toBe("2026-06-01");
    expect(days[41]?.key).toBe("2026-07-12");
  });

  it("按日分组任务并按时间和优先级排序", () => {
    const groups = groupTasksByCalendarDate([
      task({ id: "late", title: "晚任务", dueAt: "2026-06-12T08:00:00.000Z" }),
      task({ id: "low", title: "低优先级", dueAt: "2026-06-12T01:00:00.000Z", priority: 0 }),
      task({ id: "high", title: "高优先级", dueAt: "2026-06-12T01:00:00.000Z", priority: 2 }),
    ]);

    expect(groups["2026-06-12"]?.map((item) => item.id)).toEqual(["high", "low", "late"]);
  });

  it("拖拽改期优先保留截止时间字段和原时分", () => {
    const patch = buildTaskReschedulePatch(
      task({ id: "task-1", dueAt: "2026-06-12T02:30:00.000Z" }),
      new Date("2026-06-13T00:00:00.000Z"),
    );

    expect(patch).toEqual({ dueAt: "2026-06-13T02:30:00.000Z" });
  });

  it("生成可由用户应用的排期建议补丁", () => {
    const suggestions = buildScheduleSuggestions([
      task({
        id: "due-no-start",
        title: "只有截止时间",
        dueAt: "2026-06-12T10:00:00.000Z",
        estimateMin: 90,
        priority: 2,
      }),
      task({
        id: "no-estimate",
        title: "没有估时",
        startAt: "2026-06-12T09:00:00.000Z",
        estimateMin: null,
      }),
      task({
        id: "heavy",
        title: "长任务",
        startAt: "2026-06-12T13:00:00.000Z",
        estimateMin: 360,
      }),
    ], 360);

    expect(suggestions.map((item) => item.kind)).toEqual(["capacity", "schedule", "estimate"]);
    expect(suggestions[0]).toEqual(expect.objectContaining({
      taskId: "heavy",
      title: "6月12日 排期超载",
      patch: { startAt: "2026-06-13T13:00:00.000Z" },
    }));
    expect(suggestions.find((item) => item.id === "schedule:due-no-start")).toEqual(expect.objectContaining({
      patch: { startAt: "2026-06-12T08:30:00.000Z" },
    }));
    expect(suggestions.find((item) => item.id === "estimate:no-estimate")).toEqual(expect.objectContaining({
      patch: { estimateMin: 30 },
    }));
  });

  it("排期建议遇到非法截止时间时不生成随机时间补丁", () => {
    const suggestions = buildScheduleSuggestions([
      task({
        id: "invalid-due",
        title: "坏时间任务",
        dueAt: "bad-time",
        estimateMin: 60,
      }),
    ]);

    expect(suggestions).toEqual([]);
  });

  it("日历统计遇到不存在的任务日期时会跳过而不是滚动日期", () => {
    const tasks = [
      task({
        id: "bad-date",
        title: "坏日期任务",
        startAt: "2026-02-31T09:00:00.000Z",
        dueAt: "2026-02-31T10:00:00.000Z",
        estimateMin: 60,
        reminders: [{ id: "reminder-1", triggerAt: "2026-02-31T11:00:00.000Z", status: "pending", message: null }],
      }),
    ];

    expect(groupTasksByCalendarDate(tasks)).toEqual({});
    expect(buildScheduleSuggestions(tasks)).toEqual([]);
    expect(buildCalendarLoadAnalysis(tasks, 360, new Date("2026-03-01T00:00:00.000Z"))).toEqual(expect.objectContaining({
      overdueRiskCount: 0,
      dailyLoads: [],
    }));
    expect(detectCalendarConflicts(tasks)).toEqual([]);
  });

  it("分析容量负载、逾期风险和资源占用", () => {
    const analysis = buildCalendarLoadAnalysis([
      task({
        id: "overdue",
        title: "逾期任务",
        dueAt: "2026-06-12T08:00:00.000Z",
        estimateMin: 240,
        resources: [{ id: "r1", type: "person", label: "小李", amount: null, unit: null }],
      }),
      task({
        id: "unknown-estimate",
        title: "未知估时",
        startAt: "2026-06-12T10:00:00.000Z",
        estimateMin: null,
        resources: [{ id: "r2", type: "tool", label: "会议室", amount: null, unit: null }],
      }),
      task({
        id: "heavy",
        title: "长任务",
        startAt: "2026-06-12T13:00:00.000Z",
        estimateMin: 180,
        resources: [{ id: "r3", type: "person", label: "小李", amount: null, unit: null }],
      }),
    ], 360, new Date("2026-06-12T09:00:00.000Z"));

    expect(analysis.totalEstimateMin).toBe(450);
    expect(analysis.unknownEstimateCount).toBe(1);
    expect(analysis.overdueRiskCount).toBe(1);
    expect(analysis.resourceTaskCount).toBe(3);
    expect(analysis.overloadedDays).toEqual([
      { date: "2026-06-12", estimateMin: 450, taskCount: 3, overloaded: true },
    ]);
    expect(analysis.topResources).toEqual([
      { label: "小李", count: 2 },
      { label: "会议室", count: 1 },
    ]);
  });

  it("检测日历冲突", () => {
    const conflicts = detectCalendarConflicts([
      task({
        id: "first",
        title: "第一段",
        startAt: "2026-06-12T09:00:00.000Z",
        dueAt: "2026-06-12T10:00:00.000Z",
      }),
      task({
        id: "second",
        title: "第二段",
        startAt: "2026-06-12T09:30:00.000Z",
        dueAt: "2026-06-12T11:00:00.000Z",
      }),
      task({
        id: "invalid",
        title: "倒置任务",
        startAt: "2026-06-12T12:00:00.000Z",
        dueAt: "2026-06-12T11:00:00.000Z",
      }),
      task({
        id: "late-reminder",
        title: "提醒过晚任务",
        dueAt: "2026-06-12T10:00:00.000Z",
        reminders: [{ id: "reminder-1", triggerAt: "2026-06-12T11:00:00.000Z", status: "pending", message: null }],
      }),
      task({
        id: "missing-parent",
        title: "父任务缺失任务",
        parentId: "missing",
      }),
    ]);

    expect(conflicts.slice(0, 2).map((item) => item.kind)).toEqual(["invalid_range", "time_overlap"]);
    expect(conflicts.map((item) => item.kind)).toEqual(expect.arrayContaining([
      "late_reminder",
      "parent_breakdown",
    ]));
    expect(conflicts.find((item) => item.kind === "time_overlap")).toEqual(expect.objectContaining({
      taskIds: ["first", "second"],
      severity: "danger",
    }));
    expect(conflicts.find((item) => item.kind === "late_reminder")?.title).toBe("「提醒过晚任务」提醒过晚");
  });
});
