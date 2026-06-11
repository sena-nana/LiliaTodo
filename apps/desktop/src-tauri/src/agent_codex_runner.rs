use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

use mutsuki_runtime_contracts::ScalarValue;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agent_runtime_state::{record_backend_event, AgentRuntimeState};

const RUNNER_TIMEOUT: Duration = Duration::from_secs(60);
const ALLOWED_ACTION_TYPES: &[&str] = &[
    "task.create",
    "task.update",
    "task.complete",
    "task.restore",
    "task.delete",
    "task.move",
    "task.reparent",
    "taskList.create",
    "taskCategory.create",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunnerStatus {
    Disabled,
    Ready,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct AgentRunnerSuggestion {
    pub action_type: String,
    pub summary: String,
    pub risk: String,
    pub action: Value,
    pub task_ids: Vec<String>,
    pub codex_thread_id: Option<String>,
    pub codex_turn_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentRunnerTriggerResult {
    pub status: AgentRunnerStatus,
    pub diagnostic: String,
    pub suggestions: Vec<AgentRunnerSuggestion>,
}

#[derive(Debug)]
enum RunnerError {
    Spawn(String),
    AppServer(String),
    InvalidJsonl { line: usize, error: String },
    InvalidSuggestionJson(String),
    Timeout,
    Io(String),
}

#[derive(Debug)]
enum StdoutEvent {
    Line { line_no: usize, line: String },
    Io(String),
    Eof,
}

#[derive(Default)]
struct RunnerContext {
    agent_texts: Vec<String>,
    thread_id: Option<String>,
    turn_id: Option<String>,
    turn_error: Option<String>,
}

#[derive(Deserialize)]
struct CodexSuggestionOutput {
    suggestions: Vec<RawCodexSuggestion>,
}

#[derive(Deserialize)]
struct RawCodexSuggestion {
    action: Value,
    summary: Option<String>,
    task_ids: Option<Vec<String>>,
    codex_thread_id: Option<String>,
    codex_turn_id: Option<String>,
}

#[tauri::command]
pub fn agent_runtime_trigger_scan(
    state: tauri::State<'_, AgentRuntimeState>,
    snapshot: Value,
) -> AgentRunnerTriggerResult {
    let result = trigger_scan_with_command(Command::new("codex"), snapshot);
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

fn trigger_scan_with_command(mut codex_command: Command, snapshot: Value) -> AgentRunnerTriggerResult {
    match run_codex_app_server(&mut codex_command, snapshot) {
        Ok((suggestions, skipped_count)) => {
            let diagnostic = if suggestions.is_empty() {
                if skipped_count > 0 {
                    format!("Codex 扫描完成，未生成可确认建议；已跳过 {skipped_count} 条非法建议。")
                } else {
                    "Codex 扫描完成，未生成可确认建议。".into()
                }
            } else if skipped_count > 0 {
                format!(
                    "Codex 扫描完成，生成 {} 条待确认建议；已跳过 {skipped_count} 条非法建议。",
                    suggestions.len()
                )
            } else {
                format!("Codex 扫描完成，生成 {} 条待确认建议。", suggestions.len())
            };
            AgentRunnerTriggerResult {
                status: AgentRunnerStatus::Ready,
                diagnostic,
                suggestions,
            }
        }
        Err(error) => AgentRunnerTriggerResult {
            status: AgentRunnerStatus::Disabled,
            diagnostic: error.to_diagnostic(),
            suggestions: Vec::new(),
        },
    }
}

fn run_codex_app_server(
    codex_command: &mut Command,
    snapshot: Value,
) -> Result<(Vec<AgentRunnerSuggestion>, usize), RunnerError> {
    codex_command
        .arg("app-server")
        .arg("--stdio")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = codex_command
        .spawn()
        .map_err(|error| RunnerError::Spawn(error.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RunnerError::Io("无法读取 Codex app-server stdout".into()))?;
    let stderr = child.stderr.take();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || read_stdout_lines(stdout, sender));
    let stderr_receiver = stderr.map(read_stderr);

    let result = run_protocol(&mut child, &receiver, snapshot);
    cleanup_child(&mut child);

    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            let stderr = stderr_receiver
                .and_then(|receiver| receiver.recv_timeout(Duration::from_millis(200)).ok())
                .unwrap_or_default();
            Err(error.with_stderr(stderr))
        }
    }
}

fn run_protocol(
    child: &mut Child,
    receiver: &Receiver<StdoutEvent>,
    snapshot: Value,
) -> Result<(Vec<AgentRunnerSuggestion>, usize), RunnerError> {
    let deadline = Instant::now() + RUNNER_TIMEOUT;

    send_request(
        child,
        "momo-init",
        "initialize",
        json!({
            "clientInfo": {
                "name": "momo-agent",
                "title": "Momo Agent",
                "version": "0.1.0"
            },
            "capabilities": {
                "experimentalApi": true,
                "requestAttestation": false,
                "optOutNotificationMethods": []
            }
        }),
    )?;
    let mut context = RunnerContext::default();
    wait_response(receiver, "momo-init", deadline, &mut context)?;
    send_notification(child, "initialized")?;

    send_request(
        child,
        "momo-thread",
        "thread/start",
        json!({
            "cwd": std::env::current_dir().ok().and_then(|path| path.to_str().map(str::to_owned)),
            "ephemeral": true,
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "developerInstructions": developer_instructions()
        }),
    )?;
    let thread_response = wait_response(receiver, "momo-thread", deadline, &mut context)?;
    context.thread_id = value_path_string(&thread_response, &["thread", "id"]).or(context.thread_id);
    let thread_id = context
        .thread_id
        .clone()
        .ok_or_else(|| RunnerError::AppServer("Codex app-server 未返回 thread id".into()))?;

    send_request(
        child,
        "momo-turn",
        "turn/start",
        json!({
            "threadId": thread_id,
            "input": [{
                "type": "text",
                "text": build_scan_prompt(&snapshot),
                "text_elements": []
            }],
            "outputSchema": output_schema(),
            "approvalPolicy": "never"
        }),
    )?;
    let turn_response = wait_response(receiver, "momo-turn", deadline, &mut context)?;
    context.turn_id = value_path_string(&turn_response, &["turn", "id"]).or(context.turn_id);
    wait_turn_completed(receiver, deadline, &mut context)?;

    if let Some(error) = context.turn_error {
        return Err(RunnerError::AppServer(format!("Codex turn 执行失败：{error}")));
    }
    let raw_text = context
        .agent_texts
        .last()
        .cloned()
        .ok_or_else(|| RunnerError::InvalidSuggestionJson("missing_agent_message".into()))?;
    parse_suggestions_from_text(&raw_text, context.thread_id, context.turn_id)
}

fn send_request(
    child: &mut Child,
    id: &str,
    method: &str,
    params: Value,
) -> Result<(), RunnerError> {
    let request = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    write_json_line(child, &request)
}

fn send_notification(child: &mut Child, method: &str) -> Result<(), RunnerError> {
    write_json_line(child, &json!({ "method": method }))
}

fn write_json_line(child: &mut Child, value: &Value) -> Result<(), RunnerError> {
    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| RunnerError::Io("无法写入 Codex app-server stdin".into()))?;
    serde_json::to_writer(&mut *stdin, value).map_err(|error| RunnerError::Io(error.to_string()))?;
    stdin
        .write_all(b"\n")
        .map_err(|error| RunnerError::Io(error.to_string()))?;
    stdin
        .flush()
        .map_err(|error| RunnerError::Io(error.to_string()))
}

fn wait_response(
    receiver: &Receiver<StdoutEvent>,
    request_id: &str,
    deadline: Instant,
    context: &mut RunnerContext,
) -> Result<Value, RunnerError> {
    loop {
        let value = next_json_message(receiver, deadline)?;
        if value.get("id").and_then(Value::as_str) == Some(request_id) {
            if let Some(error) = value.get("error") {
                return Err(RunnerError::AppServer(error.to_string()));
            }
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }
        collect_notification(&value, context);
    }
}

fn wait_turn_completed(
    receiver: &Receiver<StdoutEvent>,
    deadline: Instant,
    context: &mut RunnerContext,
) -> Result<(), RunnerError> {
    loop {
        let value = next_json_message(receiver, deadline)?;
        collect_notification(&value, context);
        if value.get("method").and_then(Value::as_str) == Some("turn/completed") {
            return Ok(());
        }
    }
}

fn next_json_message(receiver: &Receiver<StdoutEvent>, deadline: Instant) -> Result<Value, RunnerError> {
    let now = Instant::now();
    if now >= deadline {
        return Err(RunnerError::Timeout);
    }
    let remaining = deadline.saturating_duration_since(now);
    match receiver.recv_timeout(remaining) {
        Ok(StdoutEvent::Line { line_no, line }) => serde_json::from_str::<Value>(&line)
            .map_err(|error| RunnerError::InvalidJsonl {
                line: line_no,
                error: error.to_string(),
            }),
        Ok(StdoutEvent::Io(error)) => Err(RunnerError::Io(error)),
        Ok(StdoutEvent::Eof) => Err(RunnerError::AppServer("Codex app-server 提前退出".into())),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(RunnerError::Timeout),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(RunnerError::AppServer("Codex app-server stdout 已关闭".into()))
        }
    }
}

fn collect_notification(value: &Value, context: &mut RunnerContext) {
    match value.get("method").and_then(Value::as_str) {
        Some("thread/started") => {
            context.thread_id = value_path_string(value, &["params", "thread", "id"]).or(context.thread_id.take());
        }
        Some("turn/started") => {
            context.turn_id = value_path_string(value, &["params", "turn", "id"]).or(context.turn_id.take());
        }
        Some("item/completed") => {
            if let Some(text) = agent_message_text(value.get("params").and_then(|params| params.get("item"))) {
                context.agent_texts.push(text);
            }
        }
        Some("turn/completed") => {
            if let Some(error) = value_path_string(value, &["params", "turn", "error", "message"]) {
                context.turn_error = Some(error);
            }
            if let Some(items) = value
                .get("params")
                .and_then(|params| params.get("turn"))
                .and_then(|turn| turn.get("items"))
                .and_then(Value::as_array)
            {
                for item in items {
                    if let Some(text) = agent_message_text(Some(item)) {
                        context.agent_texts.push(text);
                    }
                }
            }
        }
        Some("error") => {
            if let Some(message) = value_path_string(value, &["params", "message"]) {
                context.turn_error = Some(message);
            }
        }
        _ => {}
    }
}

fn agent_message_text(item: Option<&Value>) -> Option<String> {
    let item = item?;
    if item.get("type").and_then(Value::as_str) != Some("agentMessage") {
        return None;
    }
    item.get("text").and_then(Value::as_str).map(str::to_owned)
}

fn value_path_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_str().map(str::to_owned)
}

fn read_stdout_lines(stdout: impl Read, sender: mpsc::Sender<StdoutEvent>) {
    let mut reader = BufReader::new(stdout);
    let mut line_no = 0;
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                let _ = sender.send(StdoutEvent::Eof);
                break;
            }
            Ok(_) => {
                line_no += 1;
                let _ = sender.send(StdoutEvent::Line {
                    line_no,
                    line: line.trim_end_matches(['\r', '\n']).to_owned(),
                });
            }
            Err(error) => {
                let _ = sender.send(StdoutEvent::Io(error.to_string()));
                break;
            }
        }
    }
}

fn read_stderr(stderr: impl Read + Send + 'static) -> Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = String::new();
        let _ = reader.read_to_string(&mut buffer);
        let _ = sender.send(buffer);
    });
    receiver
}

fn cleanup_child(child: &mut Child) {
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn parse_suggestions_from_text(
    text: &str,
    thread_id: Option<String>,
    turn_id: Option<String>,
) -> Result<(Vec<AgentRunnerSuggestion>, usize), RunnerError> {
    let value = first_json_object(text)
        .map_err(|error| RunnerError::InvalidSuggestionJson(error.to_string()))?;
    let output: CodexSuggestionOutput = serde_json::from_value(value)
        .map_err(|error| RunnerError::InvalidSuggestionJson(error.to_string()))?;
    let mut suggestions = Vec::new();
    let mut skipped_count = 0;
    for raw in output.suggestions {
        match normalize_suggestion(raw, thread_id.clone(), turn_id.clone()) {
            Some(suggestion) => suggestions.push(suggestion),
            None => skipped_count += 1,
        }
    }
    Ok((suggestions, skipped_count))
}

fn normalize_suggestion(
    raw: RawCodexSuggestion,
    thread_id: Option<String>,
    turn_id: Option<String>,
) -> Option<AgentRunnerSuggestion> {
    let action_type = raw.action.get("type")?.as_str()?.to_owned();
    if !ALLOWED_ACTION_TYPES.contains(&action_type.as_str()) {
        return None;
    }
    Some(AgentRunnerSuggestion {
        action_type: action_type.clone(),
        summary: raw
            .summary
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("Codex 建议：{action_type}")),
        risk: risk_for_action(&action_type).into(),
        action: raw.action,
        task_ids: raw.task_ids.unwrap_or_default(),
        codex_thread_id: raw.codex_thread_id.or(thread_id),
        codex_turn_id: raw.codex_turn_id.or(turn_id),
    })
}

fn first_json_object(text: &str) -> serde_json::Result<Value> {
    for (index, character) in text.char_indices() {
        if character != '{' {
            continue;
        }
        let mut stream = serde_json::Deserializer::from_str(&text[index..]).into_iter::<Value>();
        if let Some(result) = stream.next() {
            let value = result?;
            if value.is_object() {
                return Ok(value);
            }
        }
    }
    serde_json::from_str("")
}

fn risk_for_action(action_type: &str) -> &'static str {
    match action_type {
        "task.delete" | "task.complete" | "task.move" | "task.reparent" => "high",
        "task.update" | "task.restore" => "medium",
        _ => "low",
    }
}

fn build_scan_prompt(snapshot: &Value) -> String {
    format!(
        "{}\n\n当前任务上下文快照：\n{}",
        "你是 Momo 的 Todo Agent。请只根据给定任务上下文生成待用户确认的 Todo 操作建议。不要调用工具，不要修改文件，不要执行任务。只返回一个 JSON 对象，字段为 suggestions。suggestions 中每项必须包含 action，action.type 只能是 task.create、task.update、task.complete、task.restore、task.delete、task.move、task.reparent、taskList.create、taskCategory.create。没有合适建议时返回 {\"suggestions\":[]}。",
        serde_json::to_string_pretty(snapshot).unwrap_or_else(|_| "{}".into())
    )
}

fn developer_instructions() -> &'static str {
    "你是 Momo Todo 应用内的建议生成后端。只输出结构化 JSON 建议，不调用工具，不执行 shell，不读取或写入文件，不直接变更任务。"
}

fn output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["suggestions"],
        "properties": {
            "suggestions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": true,
                    "required": ["action"],
                    "properties": {
                        "action": {
                            "type": "object",
                            "additionalProperties": true,
                            "required": ["type"],
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": ALLOWED_ACTION_TYPES
                                }
                            }
                        },
                        "summary": { "type": "string" },
                        "task_ids": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    }
                }
            }
        }
    })
}

impl RunnerError {
    fn to_diagnostic(&self) -> String {
        match self {
            RunnerError::Spawn(error) => format!("缺少 Codex CLI 或无法启动：{error}"),
            RunnerError::AppServer(error) => format!("Codex app-server 调用失败：{error}"),
            RunnerError::InvalidJsonl { line, error } => {
                format!("Codex app-server 输出非法 JSONL：第 {line} 行 {error}")
            }
            RunnerError::InvalidSuggestionJson(error) => {
                format!("Codex 建议输出不是合法 JSON：{error}")
            }
            RunnerError::Timeout => "Codex app-server 调用超时。".into(),
            RunnerError::Io(error) => format!("Codex app-server 通信失败：{error}"),
        }
    }

    fn with_stderr(self, stderr: String) -> Self {
        let trimmed = stderr.trim();
        if trimmed.is_empty() {
            return self;
        }
        match self {
            RunnerError::AppServer(message) => RunnerError::AppServer(format!("{message}；stderr：{trimmed}")),
            RunnerError::Io(message) => RunnerError::Io(format!("{message}；stderr：{trimmed}")),
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 缺少_codex_cli_时返回中文诊断() {
        let result = trigger_scan_with_command(Command::new("definitely-missing-codex"), json!({}));

        assert!(matches!(result.status, AgentRunnerStatus::Disabled));
        assert!(result.diagnostic.contains("缺少 Codex CLI"));
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn fake_app_server_返回合法_jsonl_时生成结构化建议() {
        let command = fake_codex_command(
            "valid",
            fake_protocol_script(r#"{"suggestions":[{"action":{"type":"task.update","taskId":"task-1","patch":{"priority":2}},"summary":"提高任务优先级","task_ids":["task-1"]}]}"#),
        );

        let result = trigger_scan_with_command(command, json!({ "tasks": [] }));

        assert!(matches!(result.status, AgentRunnerStatus::Ready));
        assert_eq!(result.suggestions.len(), 1);
        assert_eq!(result.suggestions[0].action_type, "task.update");
        assert_eq!(result.suggestions[0].risk, "medium");
        assert_eq!(result.suggestions[0].task_ids, vec!["task-1"]);
        assert_eq!(result.suggestions[0].codex_thread_id.as_deref(), Some("thread-1"));
        assert_eq!(result.suggestions[0].codex_turn_id.as_deref(), Some("turn-1"));
    }

    #[test]
    fn fake_app_server_输出非法_jsonl_时返回中文诊断() {
        let command = fake_codex_command(
            "invalid-jsonl",
            r#"
$null = [Console]::In.ReadLine()
[Console]::Out.WriteLine("not json")
"#.to_string(),
        );

        let result = trigger_scan_with_command(command, json!({}));

        assert!(matches!(result.status, AgentRunnerStatus::Disabled));
        assert!(result.diagnostic.contains("Codex app-server 输出非法 JSONL：第 1 行"));
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn fake_app_server_返回非法建议_json_时返回中文诊断() {
        let command = fake_codex_command(
            "invalid-suggestion-json",
            fake_protocol_script("Codex 没有返回 JSON"),
        );

        let result = trigger_scan_with_command(command, json!({}));

        assert!(matches!(result.status, AgentRunnerStatus::Disabled));
        assert!(result.diagnostic.contains("Codex 建议输出不是合法 JSON"));
        assert!(result.suggestions.is_empty());
    }

    fn fake_codex_command(name: &str, script: String) -> Command {
        let path = std::env::temp_dir().join(format!(
            "momo-fake-codex-{}-{name}.ps1",
            std::process::id()
        ));
        std::fs::write(&path, script).expect("写入 fake Codex app-server 脚本");
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(path);
        command
    }

    fn fake_protocol_script(agent_text: &str) -> String {
        format!(
            r#"
function Send-Json($value) {{
  $json = $value | ConvertTo-Json -Compress -Depth 20
  [Console]::Out.WriteLine($json)
}}

$agentText = {agent_text}
$null = [Console]::In.ReadLine()
Send-Json @{{ id = "momo-init"; result = @{{}} }}
$null = [Console]::In.ReadLine()
$null = [Console]::In.ReadLine()
Send-Json @{{ id = "momo-thread"; result = @{{ thread = @{{ id = "thread-1" }} }} }}
$null = [Console]::In.ReadLine()
Send-Json @{{ method = "turn/started"; params = @{{ turn = @{{ id = "turn-1" }} }} }}
Send-Json @{{ method = "item/completed"; params = @{{ item = @{{ type = "agentMessage"; id = "msg-1"; text = $agentText }} }} }}
Send-Json @{{ id = "momo-turn"; result = @{{ turn = @{{ id = "turn-1" }} }} }}
Send-Json @{{ method = "turn/completed"; params = @{{ turn = @{{ id = "turn-1"; items = @() }} }} }}
"#,
            agent_text = powershell_string(agent_text),
        )
    }

    fn powershell_string(value: &str) -> String {
        format!("'{}'", value.replace('\'', "''"))
    }
}
