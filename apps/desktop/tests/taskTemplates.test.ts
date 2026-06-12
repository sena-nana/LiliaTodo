import { describe, expect, it, vi } from "vitest";
import {
  TASK_TEMPLATES_STORAGE_KEY,
  applyTemplateToCreateInput,
  createTaskTemplate,
  loadTaskTemplates,
  saveTaskTemplates,
} from "../src/domain/taskTemplates";

describe("任务模板", () => {
  it("创建模板时规范化标题、估时和标签", () => {
    const now = new Date("2026-06-12T00:00:00.000Z");
    const template = createTaskTemplate({
      name: "  周报  ",
      title: "  写周报  ",
      estimateMin: 45,
      tags: [" 工作 ", "工作", "复盘"],
      checklist: [{ id: "", title: " 收集数据 ", done: false, order: 0 }],
      reminderOffsetMin: 30,
    }, now);

    expect(template).toEqual(expect.objectContaining({
      id: `template-${now.getTime()}`,
      name: "周报",
      title: "写周报",
      estimateMin: 45,
      tags: ["工作", "复盘"],
      reminderOffsetMin: 30,
    }));
    expect(template.checklist[0]).toEqual(expect.objectContaining({ title: "收集数据" }));
  });

  it("应用模板到创建输入并按截止时间生成提醒", () => {
    const template = createTaskTemplate({
      name: "周报",
      title: "写周报",
      estimateMin: 45,
      tags: ["工作"],
      reminderOffsetMin: 30,
    }, new Date("2026-06-12T00:00:00.000Z"));

    const input = applyTemplateToCreateInput(template, {
      title: "临时标题",
      dueAt: "2026-06-12T10:00:00.000Z",
    });

    expect(input).toEqual(expect.objectContaining({
      title: "写周报",
      estimateMin: 45,
      tags: ["工作"],
    }));
    expect(input.reminders?.[0]).toEqual(expect.objectContaining({
      triggerAt: "2026-06-12T09:30:00.000Z",
      status: "pending",
    }));
  });

  it("应用模板遇到非法截止时间时不生成提醒", () => {
    const template = createTaskTemplate({
      name: "提醒模板",
      title: "准备会议",
      reminderOffsetMin: 30,
    });

    const input = applyTemplateToCreateInput(template, {
      title: "临时标题",
      dueAt: "bad-time",
    });

    expect(input.reminders).toBeUndefined();
  });

  it("应用模板遇到不存在的截止日期时不生成提醒", () => {
    const template = createTaskTemplate({
      name: "提醒模板",
      title: "准备会议",
      reminderOffsetMin: 30,
    });

    const input = applyTemplateToCreateInput(template, {
      title: "临时标题",
      dueAt: "2026-02-31T10:00:00.000Z",
    });

    expect(input.reminders).toBeUndefined();
  });

  it("应用模板时不复用模板的标签和检查项引用", () => {
    const template = createTaskTemplate({
      name: "隔离模板",
      title: "模板任务",
      tags: ["复盘"],
      checklist: [{ id: "check-1", title: "确认事项", done: false, order: 0 }],
    });

    const input = applyTemplateToCreateInput(template, { title: "临时标题" });
    input.tags?.push("新增标签");
    if (input.checklist?.[0]) input.checklist[0].title = "已修改";

    expect(template.tags).toEqual(["复盘"]);
    expect(template.checklist[0]?.title).toBe("确认事项");
  });

  it("保存并读取模板", () => {
    const storage = {
      value: "",
      getItem: vi.fn(() => storage.value),
      setItem: vi.fn((_: string, value: string) => {
        storage.value = value;
      }),
    };
    const template = createTaskTemplate({ name: "周报", title: "写周报" });

    saveTaskTemplates(storage, [template]);

    expect(storage.setItem).toHaveBeenCalledWith(TASK_TEMPLATES_STORAGE_KEY, expect.any(String));
    expect(loadTaskTemplates(storage)).toEqual([template]);
  });

  it("读取旧版模板时补齐可选字段并跳过非法检查项", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify([
        {
          id: "template-old",
          name: "旧模板",
          title: "旧任务",
          tags: [" 复盘 ", "复盘", ""],
          checklist: [null, { title: "  保留检查项  ", done: true }],
          createdAt: "2026-06-12T00:00:00.000Z",
        },
      ])),
    };

    expect(loadTaskTemplates(storage)).toEqual([
      expect.objectContaining({
        id: "template-old",
        name: "旧模板",
        title: "旧任务",
        estimateMin: null,
        tags: ["复盘"],
        reminderOffsetMin: null,
        checklist: [expect.objectContaining({ title: "保留检查项", done: true })],
      }),
    ]);
  });

  it("读取模板检查项非字符串字段时不会中断模板加载", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify([
        {
          id: "template-dirty",
          name: "脏数据模板",
          title: "模板任务",
          checklist: [{ id: 123, title: 456, done: false }],
        },
      ])),
    };

    expect(loadTaskTemplates(storage)).toEqual([
      expect.objectContaining({
        id: "template-dirty",
        checklist: [expect.objectContaining({ id: "123", title: "456" })],
      }),
    ]);
  });
});
