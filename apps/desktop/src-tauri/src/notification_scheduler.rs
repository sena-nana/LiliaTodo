use std::{thread, time::Duration};

use tauri::{AppHandle, Emitter};

const REMINDER_TICK_EVENT: &str = "liliatodo:reminder-tick";
const REMINDER_TICK_INTERVAL_SECONDS: u64 = 60;

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(REMINDER_TICK_INTERVAL_SECONDS));
            let _ = app.emit(REMINDER_TICK_EVENT, ());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 提醒扫描事件名保持稳定() {
        assert_eq!(REMINDER_TICK_EVENT, "liliatodo:reminder-tick");
    }
}
