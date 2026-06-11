use std::{collections::BTreeMap, process::Command};

use mutsuki_runtime_contracts::ScalarValue;
use serde::Serialize;

use crate::agent_runtime_state::{record_backend_event, AgentRuntimeState};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunnerStatus {
    Disabled,
    Ready,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentRunnerSuggestion {
    pub action_type: String,
    pub summary: String,
    pub risk: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentRunnerTriggerResult {
    pub status: AgentRunnerStatus,
    pub diagnostic: String,
    pub suggestions: Vec<AgentRunnerSuggestion>,
}

#[tauri::command]
pub fn agent_runtime_trigger_scan(
    state: tauri::State<'_, AgentRuntimeState>,
) -> AgentRunnerTriggerResult {
    let result = trigger_scan_with_command(Command::new("codex"));
    let mut attributes = BTreeMap::new();
    attributes.insert(
        "status".into(),
        ScalarValue::String(match result.status {
            AgentRunnerStatus::Disabled => "disabled".into(),
            AgentRunnerStatus::Ready => "ready".into(),
        }),
    );
    attributes.insert(
        "suggestion_count".into(),
        ScalarValue::Int(result.suggestions.len() as i64),
    );
    attributes.insert(
        "diagnostic".into(),
        ScalarValue::String(result.diagnostic.clone()),
    );
    record_backend_event(&state, "codex.runner.scan", attributes);
    result
}

fn trigger_scan_with_command(mut codex_command: Command) -> AgentRunnerTriggerResult {
    let version = codex_command.arg("--version").output();
    match version {
        Ok(output) if output.status.success() => AgentRunnerTriggerResult {
            status: AgentRunnerStatus::Ready,
            diagnostic: "Codex app-server runner 已可用，当前返回结构化建议占位。".into(),
            suggestions: vec![AgentRunnerSuggestion {
                action_type: "task.update".into(),
                summary: "根据本地任务上下文生成 Todo 操作建议。".into(),
                risk: "medium".into(),
            }],
        },
        Ok(output) => AgentRunnerTriggerResult {
            status: AgentRunnerStatus::Disabled,
            diagnostic: format!(
                "Codex CLI 版本检查失败：{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
            suggestions: Vec::new(),
        },
        Err(error) => AgentRunnerTriggerResult {
            status: AgentRunnerStatus::Disabled,
            diagnostic: format!("缺少 Codex CLI 或无法启动：{error}"),
            suggestions: Vec::new(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 缺少_codex_cli_时返回中文诊断() {
        let result = trigger_scan_with_command(Command::new("definitely-missing-codex"));

        assert!(matches!(result.status, AgentRunnerStatus::Disabled));
        assert!(result.diagnostic.contains("缺少 Codex CLI"));
        assert!(result.suggestions.is_empty());
    }
}
