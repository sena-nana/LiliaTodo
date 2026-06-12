import { describe, expect, it } from "vitest";
import { exportTasks, importTaskRecords, importTasks } from "../src/domain/taskImportExport";
import { taskFixture as task } from "./taskFixtures";

describe("任务导入导出", () => {
  it("导出和导入 JSON 任务", () => {
    const text = exportTasks([
      task({
        title: "写报告",
        notes: "给客户",
        priority: 2,
        dueAt: "2026-06-12T10:00:00.000Z",
        estimateMin: 45,
        tags: ["客户"],
        resources: [{ id: "r1", type: "person", label: "小李", amount: null, unit: null }],
        reminders: [{ id: "reminder-1", triggerAt: "2026-06-12T09:00:00.000Z", status: "pending", message: "提前提醒" }],
        checklist: [{ id: "check-1", title: "确认数据", done: false, order: 0 }],
        recurrence: { enabled: true, unit: "week", interval: 1 },
      }),
    ], "json");

    expect(importTasks(text, "json")).toEqual([
      expect.objectContaining({
        title: "写报告",
        notes: "给客户",
        priority: 2,
        dueAt: "2026-06-12T10:00:00.000Z",
        estimateMin: 45,
        tags: ["客户"],
        resources: [{ id: "r1", type: "person", label: "小李", amount: null, unit: null }],
        reminders: [{ id: "reminder-1", triggerAt: "2026-06-12T09:00:00.000Z", status: "pending", message: "提前提醒" }],
        checklist: [{ id: "check-1", title: "确认数据", done: false, order: 0 }],
        recurrence: { enabled: true, unit: "week", interval: 1 },
      }),
    ]);
    expect(importTaskRecords(text, "json")[0]?.status).toBe("active");
  });

  it("导入 CSV 任务", () => {
    const inputs = importTasks([
      "title,notes,priority,dueAt,estimateMin,tags",
      "\"写,报告\",给客户,2,2026-06-12T10:00:00.000Z,45,客户|复盘",
    ].join("\n"), "csv");

    expect(inputs).toEqual([
      expect.objectContaining({
        title: "写,报告",
        notes: "给客户",
        priority: 2,
        estimateMin: 45,
        tags: ["客户", "复盘"],
      }),
    ]);
  });

  it("导入带 BOM 的 CSV 表头", () => {
    expect(importTasks("\uFEFFtitle,notes\n导入任务,从表格复制", "csv")).toEqual([
      expect.objectContaining({
        title: "导入任务",
        notes: "从表格复制",
      }),
    ]);
  });

  it("导入重复表头的 CSV 时显示中文错误", () => {
    expect(() => importTaskRecords("title,title\n第一列,第二列", "csv")).toThrow("导入 CSV 存在重复表头：title");
  });

  it("导入 Markdown 勾选列表任务", () => {
    expect(importTasks("- [ ] 准备会议\n- [x] 复盘", "markdown")).toEqual([
      expect.objectContaining({ title: "准备会议" }),
      expect.objectContaining({ title: "复盘" }),
    ]);
    expect(importTaskRecords("- [ ] 准备会议\n- [x] 复盘", "markdown").map((record) => record.status)).toEqual([
      "active",
      "completed",
    ]);
  });

  it("Markdown 导出后重新导入会保留截止时间、估时和标签", () => {
    const text = exportTasks([
      task({
        title: "准备复盘",
        status: "completed",
        dueAt: "2026-06-12T10:00:00.000Z",
        estimateMin: 45,
        tags: ["客户", "复盘"],
      }),
    ], "markdown");

    expect(importTaskRecords(text, "markdown")).toEqual([
      expect.objectContaining({
        status: "completed",
        input: expect.objectContaining({
          title: "准备复盘",
          dueAt: "2026-06-12T10:00:00.000Z",
          estimateMin: 45,
          tags: ["客户", "复盘"],
        }),
      }),
    ]);
  });

  it("导入 JSON 和 CSV 时保留目标状态", () => {
    expect(importTaskRecords('{"title":"已完成","status":"completed"}', "json")[0]).toEqual(expect.objectContaining({
      status: "completed",
      input: expect.objectContaining({ title: "已完成" }),
    }));
    expect(importTaskRecords("title,status\n已归档,archived", "csv")[0]).toEqual(expect.objectContaining({
      status: "archived",
      input: expect.objectContaining({ title: "已归档" }),
    }));
  });

  it("导入状态字段带空格时仍识别目标状态", () => {
    expect(importTaskRecords('{"title":"已完成","status":" completed "}', "json")[0]?.status).toBe("completed");
    expect(importTaskRecords("title,status\n已归档, archived ", "csv")[0]?.status).toBe("archived");
  });

  it("空导入内容会提示没有可导入任务", () => {
    expect(() => importTaskRecords("只是普通说明文字", "markdown")).toThrow("没有找到可导入的任务");
    expect(() => importTaskRecords("title,status\n", "csv")).toThrow("没有找到可导入的任务");
  });

  it("非法 JSON 导入会提示中文格式错误", () => {
    expect(() => importTaskRecords("{bad json", "json")).toThrow("导入 JSON 格式不合法");
  });

  it("未闭合引号的 CSV 导入会提示中文格式错误", () => {
    expect(() => importTaskRecords('title,notes\n"损坏任务,备注', "csv")).toThrow("导入 CSV 格式不合法");
  });

  it("缺少 title 表头的 CSV 导入会提示必需字段", () => {
    expect(() => importTaskRecords("name,notes\n错误表头,备注", "csv")).toThrow("导入 CSV 缺少 title 表头");
  });

  it("导入非法任务时间时显示中文错误", () => {
    expect(() => importTaskRecords('{"title":"坏时间","startAt":"bad-time"}', "json")).toThrow("导入任务开始时间不合法");
    expect(() => importTaskRecords("title,dueAt\n坏时间,bad-time", "csv")).toThrow("导入任务截止时间不合法");
  });

  it("导入不存在的日期时显示中文错误", () => {
    expect(() => importTaskRecords('{"title":"坏日期","dueAt":"2026-02-31"}', "json")).toThrow("导入任务截止时间不合法");
    expect(() => importTaskRecords("title,startAt\n坏日期,2026-02-31T10:00:00.000Z", "csv")).toThrow("导入任务开始时间不合法");
    expect(() => importTaskRecords('{"title":"坏提醒","reminders":[{"triggerAt":"2026-02-31T09:00:00.000Z"}]}', "json")).toThrow("导入任务提醒第 1 项时间不合法");
  });
});
