use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub type AgentId = String;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPhase {
    Spawn,
    Awake,
    Sleep,
    Stop,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeEventKind {
    Lifecycle,
    Routing,
    Operation,
    Resource,
    Trace,
    Backend,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScalarValue {
    String(String),
    Int(i64),
    Float(f64),
    Bool(bool),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuntimeError {
    pub code: String,
    pub source: String,
    pub route: String,
    pub lost_capability: Option<String>,
    pub recovery: Option<String>,
    pub cause: Option<Box<RuntimeError>>,
    pub evidence: BTreeMap<String, ScalarValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuntimeEvent {
    pub sequence: u64,
    pub kind: RuntimeEventKind,
    pub name: String,
    pub agent_id: Option<AgentId>,
    pub attributes: BTreeMap<String, ScalarValue>,
    pub error: Option<RuntimeError>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn runtime_event_json_保持前端契约() {
        let event = RuntimeEvent {
            sequence: 7,
            kind: RuntimeEventKind::Backend,
            name: "codex.runner.scan.completed".to_string(),
            agent_id: Some("momo-agent".to_string()),
            attributes: BTreeMap::from([
                (
                    "status".to_string(),
                    ScalarValue::String("ready".to_string()),
                ),
                ("suggestion_count".to_string(), ScalarValue::Int(2)),
                ("backend_configured".to_string(), ScalarValue::Bool(true)),
            ]),
            error: None,
        };

        assert_eq!(
            serde_json::to_value(event).unwrap(),
            json!({
                "sequence": 7,
                "kind": "backend",
                "name": "codex.runner.scan.completed",
                "agent_id": "momo-agent",
                "attributes": {
                    "backend_configured": true,
                    "status": "ready",
                    "suggestion_count": 2
                },
                "error": null
            })
        );
    }
}
