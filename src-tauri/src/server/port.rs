use std::sync::OnceLock;

static PORT: OnceLock<u16> = OnceLock::new();

pub fn set(port: u16) {
    PORT.set(port).ok();
}

pub fn get() -> u16 {
    *PORT.get().unwrap_or(&9200)
}
