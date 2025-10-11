// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod server;

use std::net::SocketAddr;
use std::thread;
use tokio::runtime::Runtime;

use crate::server::file_server;

fn main() {
    thread::spawn(|| {
        // We need a Tokio runtime inside this thread
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let addr: SocketAddr = ([127, 0, 0, 1], 8893).into();
            file_server::start_server(addr).await;
        });
    });

    ffstudio_lib::run()
}
