use image::{load_from_memory, Rgba};
use tauri::image::Image as TauriImage;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIcon;

pub struct TrayState {
    pub tray: TrayIcon,
}

impl TrayState {
    pub fn set_status(&self, color: &str) {
        let rgba = make_colored_icon(color);
        let img = TauriImage::new(&rgba, 32, 32);
        let _ = self.tray.set_icon(Some(img));
    }

    pub fn set_menu_texts(&self, queue_text: &str, wf_text: &str) {
        let app = self.tray.app_handle();

        let show = match MenuItem::with_id(app, "show", "Show Window", true, None::<&str>) {
            Ok(m) => m,
            Err(_) => return,
        };
        let sep1 = match PredefinedMenuItem::separator(app) {
            Ok(m) => m,
            Err(_) => return,
        };
        let queue_status = match MenuItem::with_id(app, "queue_status", queue_text, false, None::<&str>) {
            Ok(m) => m,
            Err(_) => return,
        };
        let wf_status = match MenuItem::with_id(app, "wf_status", wf_text, false, None::<&str>) {
            Ok(m) => m,
            Err(_) => return,
        };
        let cancel_all = match MenuItem::with_id(app, "cancel_all", "Cancel All Jobs", true, None::<&str>) {
            Ok(m) => m,
            Err(_) => return,
        };
        let stop_wf = match MenuItem::with_id(app, "stop_wf", "Stop All Watch Folders", true, None::<&str>) {
            Ok(m) => m,
            Err(_) => return,
        };
        let sep2 = match PredefinedMenuItem::separator(app) {
            Ok(m) => m,
            Err(_) => return,
        };
        let quit = match MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q")) {
            Ok(m) => m,
            Err(_) => return,
        };

        let menu = match Menu::new(app) {
            Ok(m) => m,
            Err(_) => return,
        };
        let _ = menu.append(&show);
        let _ = menu.append(&sep1);
        let _ = menu.append(&queue_status);
        let _ = menu.append(&wf_status);
        let _ = menu.append(&cancel_all);
        let _ = menu.append(&stop_wf);
        let _ = menu.append(&sep2);
        let _ = menu.append(&quit);

        let _ = self.tray.set_menu(Some(menu));
    }
}

fn make_colored_icon(color: &str) -> Vec<u8> {
    let base = include_bytes!("../icons/32x32.png");
    let mut img = load_from_memory(base).unwrap().to_rgba8();

    let dot_color = match color {
        "green" => Rgba([76, 175, 80, 255]),
        "blue" => Rgba([33, 150, 243, 255]),
        "yellow" => Rgba([255, 193, 7, 255]),
        _ => Rgba([158, 158, 158, 255]),
    };

    let _w = img.width();
    let h = img.height();
    let r = 5u32;
    let margin = 2u32;
    let cx = margin + r;
    let cy = h - margin - r;

    for y in (cy - r)..=(cy + r) {
        for x in (cx - r)..=(cx + r) {
            let dx = x as i32 - cx as i32;
            let dy = y as i32 - cy as i32;
            if dx * dx + dy * dy <= (r * r) as i32 {
                img.put_pixel(x, y, dot_color);
            }
        }
    }

    img.into_raw()
}
