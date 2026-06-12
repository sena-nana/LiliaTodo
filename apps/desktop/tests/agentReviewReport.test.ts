import { describe, expect, it } from 'vitest';
import { buildAgentReviewReport, formatReviewMinutes } from '../src/agent/reviewReport';
import { taskFixture } from './taskFixtures';

describe('Agent 复盘报告', () => {
  it('按日和周统计完成情况、延期原因和下周建议', () => {
    const report = buildAgentReviewReport([
      taskFixture({ id: 'done-1', title: '完成报告', status: 'completed', startAt: '2026-06-09T09:00:00.000Z', completedAt: '2026-06-10T10:00:00.000Z', estimateMin: 90 }),
      taskFixture({ id: 'late-1', title: '逾期任务', dueAt: '2026-06-09T10:00:00.000Z', estimateMin: 60 }),
      taskFixture({ id: 'missing-start', title: '只有截止', dueAt: '2026-06-12T18:00:00.000Z', estimateMin: null }),
      taskFixture({ id: 'next-high', title: '下周重点', startAt: '2026-06-15T09:00:00.000Z', priority: 3, estimateMin: null }),
    ], { now: new Date('2026-06-12T12:00:00.000Z'), dailyCapacityMin: 120 });

    expect(report.weekly.plannedCount).toBe(3);
    expect(report.weekly.completedCount).toBe(1);
    expect(report.weekly.completedEstimateMin).toBe(90);
    expect(report.daily.find((day) => day.date === '2026-06-10')).toMatchObject({ completedCount: 1, completedEstimateMin: 90 });
    expect(report.delayReasons.map((reason) => reason.title)).toEqual(expect.arrayContaining(['已逾期未完成', '有截止但无开始时间', '缺少估时']));
    expect(report.nextWeekSuggestions.map((suggestion) => suggestion.title)).toEqual(expect.arrayContaining(['先清理逾期任务', '保护高优先级任务']));
  });

  it('没有延期原因时给出维持节奏建议', () => {
    const report = buildAgentReviewReport([
      taskFixture({ id: 'done-1', status: 'completed', completedAt: '2026-06-10T10:00:00.000Z', estimateMin: 30 }),
    ], { now: new Date('2026-06-12T12:00:00.000Z') });

    expect(report.delayReasons).toEqual([]);
    expect(report.nextWeekSuggestions[0]).toMatchObject({ title: '维持当前节奏' });
    expect(formatReviewMinutes(95)).toBe('1 小时 35 分钟');
  });

  it('日复盘延期只统计当天计划任务', () => {
    const report = buildAgentReviewReport([
      taskFixture({ id: 'old-late', title: '旧逾期', dueAt: '2026-06-09T10:00:00.000Z' }),
      taskFixture({ id: 'today-late', title: '当天逾期', dueAt: '2026-06-12T10:00:00.000Z' }),
    ], { now: new Date('2026-06-12T12:00:00.000Z'), dailyLookbackDays: 2 });

    expect(report.daily.find((day) => day.date === '2026-06-11')).toMatchObject({
      plannedCount: 0,
      delayedCount: 0,
    });
    expect(report.daily.find((day) => day.date === '2026-06-12')).toMatchObject({
      plannedCount: 1,
      delayedCount: 1,
    });
  });

  it('已完成的历史逾期任务不触发清理逾期建议', () => {
    const report = buildAgentReviewReport([
      taskFixture({
        id: 'done-late',
        title: '已完成旧逾期',
        status: 'completed',
        dueAt: '2026-06-09T10:00:00.000Z',
        completedAt: '2026-06-11T10:00:00.000Z',
      }),
    ], { now: new Date('2026-06-12T12:00:00.000Z') });

    expect(report.delayReasons.map((reason) => reason.id)).not.toContain('overdue');
    expect(report.nextWeekSuggestions.map((suggestion) => suggestion.id)).not.toContain('clear-overdue');
  });

  it('非法时间任务不会计入逾期、计划或容量统计', () => {
    const report = buildAgentReviewReport([
      taskFixture({ id: 'bad-due', title: '坏截止', dueAt: 'bad-time', estimateMin: 600 }),
      taskFixture({ id: 'bad-start', title: '坏开始', startAt: 'bad-time', estimateMin: 600 }),
    ], { now: new Date('2026-06-12T12:00:00.000Z'), dailyCapacityMin: 120 });

    expect(report.weekly.plannedCount).toBe(0);
    expect(report.delayReasons.map((reason) => reason.id)).not.toEqual(expect.arrayContaining([
      'overdue',
      'missing-estimate',
      'over-capacity',
    ]));
    expect(report.nextWeekSuggestions.map((suggestion) => suggestion.id)).not.toContain('clear-overdue');
  });
});
