use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::watch;

#[derive(Clone, Default)]
pub struct StreamCancellationRegistry {
    inner: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl StreamCancellationRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, request_id: &str) -> watch::Receiver<bool> {
        let (sender, receiver) = watch::channel(false);

        if let Ok(mut guard) = self.inner.lock() {
            guard.insert(request_id.to_string(), sender);
        }

        receiver
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        let sender = self
            .inner
            .lock()
            .ok()
            .and_then(|guard| guard.get(request_id).cloned());

        match sender {
            Some(sender) => sender.send(true).is_ok(),
            None => false,
        }
    }

    pub fn remove(&self, request_id: &str) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.remove(request_id);
        }
    }
}
