use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::thread::JoinHandle;
use std::time::Duration;

use once_cell::sync::Lazy;

use super::types::{AudioError, AudioFormat, CapturedAudio, RecorderState};

static RECORDER: Lazy<Mutex<AudioRecorder>> = Lazy::new(|| Mutex::new(AudioRecorder::new()));

const INIT_TIMEOUT: Duration = Duration::from_secs(3);

pub struct RecordingSession {
    pub stop_tx: mpsc::Sender<()>,
    pub worker: JoinHandle<Result<CapturedAudio, AudioError>>,
}

pub struct AudioRecorder {
    state: RecorderState,
    session: Option<RecordingSession>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            state: RecorderState::Idle,
            session: None,
        }
    }

    pub fn start(&mut self) -> Result<(), AudioError> {
        if self.session.is_some() || self.state != RecorderState::Idle {
            return Err(AudioError::AlreadyRecording);
        }

        let (ready_tx, ready_rx) = mpsc::channel();
        let (stop_tx, stop_rx) = mpsc::channel();
        let worker = spawn_capture_thread(ready_tx, stop_rx);

        self.state = RecorderState::Starting;

        match ready_rx.recv_timeout(INIT_TIMEOUT) {
            Ok(Ok(_format)) => {
                self.session = Some(RecordingSession { stop_tx, worker });
                self.state = RecorderState::Recording;
                Ok(())
            }
            Ok(Err(error)) => {
                self.state = RecorderState::Failed;
                let _ = worker.join();
                self.state = RecorderState::Idle;
                Err(error)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.state = RecorderState::Failed;
                let _ = stop_tx.send(());
                let _ = worker.join();
                self.state = RecorderState::Idle;
                Err(AudioError::InitializationTimeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.state = RecorderState::Failed;
                let joined = worker
                    .join()
                    .map_err(|_| AudioError::WorkerThread("录音线程异常退出".to_string()))?;
                self.state = RecorderState::Idle;
                match joined {
                    Ok(_) => Err(AudioError::WorkerThread(
                        "录音线程在初始化阶段提前退出".to_string(),
                    )),
                    Err(error) => Err(error),
                }
            }
        }
    }

    pub fn stop(&mut self) -> Result<CapturedAudio, AudioError> {
        let session = self.session.take().ok_or(AudioError::NotRecording)?;
        self.state = RecorderState::Stopping;

        session
            .stop_tx
            .send(())
            .map_err(|error| AudioError::Synchronization(error.to_string()))?;

        let joined = session
            .worker
            .join()
            .map_err(|_| AudioError::WorkerThread("录音线程异常退出".to_string()))?;

        match joined {
            Ok(captured) => {
                self.state = RecorderState::Idle;
                Ok(captured)
            }
            Err(error) => {
                self.state = RecorderState::Failed;
                self.state = RecorderState::Idle;
                Err(error)
            }
        }
    }

    #[cfg(test)]
    pub fn state(&self) -> RecorderState {
        self.state
    }
}

pub fn start_recording() -> Result<(), AudioError> {
    RECORDER
        .lock()
        .map_err(|error| AudioError::Synchronization(error.to_string()))?
        .start()
}

pub fn stop_recording() -> Result<CapturedAudio, AudioError> {
    RECORDER
        .lock()
        .map_err(|error| AudioError::Synchronization(error.to_string()))?
        .stop()
}

pub(crate) fn spawn_capture_thread(
    ready_tx: mpsc::Sender<Result<AudioFormat, AudioError>>,
    stop_rx: mpsc::Receiver<()>,
) -> JoinHandle<Result<CapturedAudio, AudioError>> {
    thread::spawn(move || {
        #[cfg(target_os = "windows")]
        {
            super::windows_wasapi::capture_default_loopback(ready_tx, stop_rx)
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = ready_tx.send(Err(AudioError::Wasapi(
                "当前平台不支持系统输出音频录制".to_string(),
            )));
            let _ = stop_rx.recv_timeout(Duration::from_millis(1));
            Err(AudioError::Wasapi(
                "当前平台不支持系统输出音频录制".to_string(),
            ))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_returns_error_when_recorder_is_idle() {
        let mut recorder = AudioRecorder::new();

        let error = recorder.stop().expect_err("stop should fail when idle");

        assert!(matches!(error, AudioError::NotRecording));
    }

    #[test]
    fn new_recorder_starts_in_idle_state() {
        let recorder = AudioRecorder::new();

        assert_eq!(recorder.state(), RecorderState::Idle);
    }
}
