use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub fn short_hash(input: &str) -> String {
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    let hash = hasher.finish(); // u64

    // Format like a short GUID (hex with dashes)
    format!("{:08x}-{:04x}-{:04x}", 
        (hash >> 32) as u32, 
        ((hash >> 16) & 0xffff) as u16, 
        (hash & 0xffff) as u16)
}
