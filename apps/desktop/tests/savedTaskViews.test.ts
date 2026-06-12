import { describe, expect, it, vi } from "vitest";
import {
  SAVED_TASK_VIEWS_STORAGE_KEY,
  builtInSavedTaskViews,
  createSavedTaskView,
  loadSavedTaskViews,
  saveTaskViews,
} from "../src/domain/savedTaskViews";

describe("智能视图保存", () => {
  it("内置本周高优先级视图使用本地周一到周日范围", () => {
    const view = builtInSavedTaskViews(new Date("2026-06-12T10:00:00.000Z"))
      .find((item) => item.id === "builtin-this-week-high-priority");

    expect(view?.query).toEqual(expect.objectContaining({
      status: "active",
      priority: 2,
      timeMode: "scheduled",
      timeFrom: "2026-06-08T00:00",
      timeTo: "2026-06-14T23:59",
    }));
  });

  it("创建视图时规范化名称和查询", () => {
    const now = new Date("2026-06-12T00:00:00.000Z");
    const view = createSavedTaskView(
      "  客户复盘  ",
      {
        keyword: "  报告  ",
        status: "completed",
        tagText: " 客户 ",
        listId: " project ",
        categoryId: " category-1 ",
        priority: 2,
        timeMode: "scheduled",
        timeFrom: "2026-06-01T00:00",
        timeTo: "2026-06-30T23:59",
        reminderStatus: "due",
        includeDeleted: true,
      },
      now,
    );

    expect(view).toEqual(expect.objectContaining({
      id: `view-${now.getTime()}`,
      name: "客户复盘",
      builtIn: false,
    }));
    expect(view.query).toEqual(expect.objectContaining({
      keyword: "报告",
      listId: "project",
      categoryId: "category-1",
      timeMode: "scheduled",
    }));
  });

  it("内置无计划视图筛选没有开始和截止时间的任务", () => {
    const view = builtInSavedTaskViews(new Date("2026-06-12T00:00:00.000Z"))
      .find((item) => item.id === "builtin-unplanned");

    expect(view?.query).toEqual(expect.objectContaining({
      status: "active",
      timeMode: "unscheduled",
      reminderStatus: "all",
    }));
  });

  it("名称为空时拒绝保存", () => {
    expect(() => createSavedTaskView(" ", builtInSavedTaskViews()[0]!.query)).toThrow("视图名称不能为空");
  });

  it("只持久化自定义视图并能读取", () => {
    const storage = {
      value: "",
      getItem: vi.fn(() => storage.value),
      setItem: vi.fn((_: string, value: string) => {
        storage.value = value;
      }),
    };
    const customView = createSavedTaskView("自定义", builtInSavedTaskViews()[0]!.query, new Date("2026-06-12T00:00:00.000Z"));

    saveTaskViews(storage, [builtInSavedTaskViews()[0]!, customView]);

    expect(storage.setItem).toHaveBeenCalledWith(SAVED_TASK_VIEWS_STORAGE_KEY, expect.any(String));
    expect(loadSavedTaskViews(storage)).toEqual([customView]);
  });

  it("读取旧版不完整查询时使用默认条件补齐", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify([
        {
          id: "view-old",
          name: "旧视图",
          builtIn: false,
          query: { keyword: "  客户  ", status: "active" },
          createdAt: "2026-06-12T00:00:00.000Z",
        },
      ])),
    };

    expect(loadSavedTaskViews(storage)).toEqual([
      expect.objectContaining({
        id: "view-old",
        name: "旧视图",
        query: expect.objectContaining({
          keyword: "客户",
          status: "active",
          priority: "all",
          timeMode: "all",
          includeDeleted: false,
        }),
      }),
    ]);
  });

  it("读取非字符串查询字段时不会中断视图加载", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify([
        {
          id: "view-dirty",
          name: "脏数据视图",
          builtIn: false,
          query: {
            keyword: 123,
            tagText: null,
            listId: ["list"],
            categoryId: undefined,
            timeFrom: 456,
            timeTo: null,
          },
        },
      ])),
    };

    expect(loadSavedTaskViews(storage)).toEqual([
      expect.objectContaining({
        id: "view-dirty",
        query: expect.objectContaining({
          keyword: "123",
          tagText: "",
          listId: "list",
          categoryId: "",
          timeFrom: "",
          timeTo: "",
        }),
      }),
    ]);
  });
});
