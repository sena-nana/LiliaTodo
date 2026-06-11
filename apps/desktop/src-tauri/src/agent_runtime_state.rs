use std::{
    collections::BTreeMap,
    sync::{Mutex, MutexGuard},
};

use mutsuki_runtime_contracts::{
    AgentId, AgentPhase, RuntimeError, RuntimeEvent, RuntimeEventKind, ScalarValue,
};
use serde::Serialize;
use tauri::{AppHandle, Manager};

const EVENT_BUFFER_CAPACITY: usize = 64;
const DEFAULT_AGENT_ID: &str = "local-agent";
const DISABLED_REASON: &str = "尚未配置 backend，Agent 已禁用。";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeLifecycle {
    Bootstrapping,
    Disabled,
    Running,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentRuntimeStatusSnapshot {
    pub lifecycle: AgentRuntimeLifecycle,
    pub agent_id: Option<AgentId>,
    pub agent_phase: Option<AgentPhase>,
    pub backend_configured: bool,
    pub disabled_reason: Option<String>,
    pub buffered_event_count: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentRuntimeEventsSnapshot {
    pub events: Vec<RuntimeEvent>,
}

#[derive(Clone, Debug)]
pub struct AgentRuntimeStateStore {
    lifecycle: AgentRuntimeLifecycle,
    agent_id: Option<AgentId>,
    agent_phase: Option<AgentPhase>,
    backend_configured: bool,
    disabled_reason: Option<String>,
    events: Vec<RuntimeEvent>,
    next_sequence: u64,
}

impl Default for AgentRuntimeStateStore {
    fn default() -> Self {
        let mut store = Self {
            lifecycle: AgentRuntimeLifecycle::Bootstrapping,
            agent_id: Some(DEFAULT_AGENT_ID.into()),
            agent_phase: Some(AgentPhase::Spawn),
            backend_configured: false,
            disabled_reason: None,
            events: Vec::new(),
            next_sequence: 0,
        };
        store.bootstrap_disabled();
        store
    }
}

impl AgentRuntimeStateStore {
    fn bootstrap_disabled(&mut self) {
        self.push_lifecycle("runtime.bootstrap", BTreeMap::new());
        self.lifecycle = AgentRuntimeLifecycle::Disabled;
        self.agent_phase = Some(AgentPhase::Stop);
        self.disabled_reason = Some(DISABLED_REASON.into());
        let mut attributes = BTreeMap::new();
        attributes.insert("reason".into(), ScalarValue::String(DISABLED_REASON.into()));
        attributes.insert("backend_configured".into(), ScalarValue::Bool(false));
        self.push_lifecycle("runtime.disabled", attributes);
    }

    fn push_event(
        &mut self,
        kind: RuntimeEventKind,
        name: impl Into<String>,
        attributes: BTreeMap<String, ScalarValue>,
        error: Option<RuntimeError>,
    ) {
        self.next_sequence += 1;
        let event = RuntimeEvent {
            sequence: self.next_sequence,
            kind,
            name: name.into(),
            agent_id: self.agent_id.clone(),
            attributes,
            error,
        };
        self.events.push(event);
        if self.events.len() > EVENT_BUFFER_CAPACITY {
            let overflow = self.events.len() - EVENT_BUFFER_CAPACITY;
            self.events.drain(0..overflow);
        }
    }

    fn push_lifecycle(&mut self, name: impl Into<String>, attributes: BTreeMap<String, ScalarValue>) {
        self.push_event(RuntimeEventKind::Lifecycle, name, attributes, None);
    }

    fn push_backend(&mut self, name: impl Into<String>, attributes: BTreeMap<String, ScalarValue>) {
        self.push_event(RuntimeEventKind::Backend, name, attributes, None);
    }

    fn status_snapshot(&self) -> AgentRuntimeStatusSnapshot {
        AgentRuntimeStatusSnapshot {
            lifecycle: self.lifecycle.clone(),
            agent_id: self.agent_id.clone(),
            agent_phase: self.agent_phase.clone(),
            backend_configured: self.backend_configured,
            disabled_reason: self.disabled_reason.clone(),
            buffered_event_count: self.events.len(),
        }
    }

    fn events_snapshot(&self) -> AgentRuntimeEventsSnapshot {
        AgentRuntimeEventsSnapshot {
            events: self.events.clone(),
        }
    }
}

pub type AgentRuntimeState = Mutex<AgentRuntimeStateStore>;

fn lock_state<'a>(state: &'a AgentRuntimeState) -> MutexGuard<'a, AgentRuntimeStateStore> {
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn init(app: &AppHandle) {
    app.manage(Mutex::new(AgentRuntimeStateStore::default()));
}

pub fn record_backend_event(
    state: &tauri::State<'_, AgentRuntimeState>,
    name: impl Into<String>,
    attributes: BTreeMap<String, ScalarValue>,
) {
    lock_state(state).push_backend(name, attributes);
}

#[tauri::command]
pub fn agent_runtime_start(state: tauri::State<'_, AgentRuntimeState>) -> AgentRuntimeStatusSnapshot {
    let mut store = lock_state(&state);
    store.lifecycle = AgentRuntimeLifecycle::Running;
    store.agent_phase = Some(AgentPhase::Awake);
    store.disabled_reason = None;
    store.push_lifecycle("runtime.start", BTreeMap::new());
    store.status_snapshot()
}

#[tauri::command]
pub fn agent_runtime_stop(state: tauri::State<'_, AgentRuntimeState>) -> AgentRuntimeStatusSnapshot {
    let mut store = lock_state(&state);
    store.lifecycle = AgentRuntimeLifecycle::Disabled;
    store.agent_phase = Some(AgentPhase::Stop);
    store.disabled_reason = Some(DISABLED_REASON.into());
    store.push_lifecycle("runtime.stop", BTreeMap::new());
    store.status_snapshot()
}

#[tauri::command]
pub fn agent_runtime_get_status(
    state: tauri::State<'_, AgentRuntimeState>,
) -> AgentRuntimeStatusSnapshot {
    lock_state(&state).status_snapshot()
}

#[tauri::command]
pub fn agent_runtime_list_events(
    state: tauri::State<'_, AgentRuntimeState>,
) -> AgentRuntimeEventsSnapshot {
    lock_state(&state).events_snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 默认状态即为已禁用并带清晰原因() {
        let store = AgentRuntimeStateStore::default();
        let snapshot = store.status_snapshot();

        assert!(matches!(snapshot.lifecycle, AgentRuntimeLifecycle::Disabled));
        assert_eq!(snapshot.agent_id.as_deref(), Some(DEFAULT_AGENT_ID));
        assert_eq!(snapshot.agent_phase, Some(AgentPhase::Stop));
        assert_eq!(snapshot.disabled_reason.as_deref(), Some(DISABLED_REASON));
        assert!(!snapshot.backend_configured);
        assert_eq!(snapshot.buffered_event_count, 2);
    }

    #[test]
    fn 事件缓冲按固定容量保留最新事件() {
        let mut store = AgentRuntimeStateStore::default();
        for index in 0..EVENT_BUFFER_CAPACITY + 5 {
            let mut attributes = BTreeMap::new();
            attributes.insert("index".into(), ScalarValue::Int(index as i64));
            store.push_event(
                RuntimeEventKind::Lifecycle,
                format!("event-{index}"),
                attributes,
                None,
            );
        }

        let events = store.events_snapshot().events;
        assert_eq!(events.len(), EVENT_BUFFER_CAPACITY);
        assert_eq!(events.first().map(|event| event.name.as_str()), Some("event-5"));
        assert_eq!(
            events.last().and_then(|event| event.attributes.get("index")),
            Some(&ScalarValue::Int((EVENT_BUFFER_CAPACITY + 4) as i64))
        );
    }
}
