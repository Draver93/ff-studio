use image::{load_from_memory, Rgba};
use tauri::image::Image as TauriImage;
use tauri::menu::MenuItem;
use tauri::tray::TrayIcon;

pub struct TrayState {
    pub tray: TrayIcon,
    pub queue_status: MenuItem<tauri::Wry>,
    pub wf_status: MenuItem<tauri::Wry>,
}

impl TrayState {
    pub fn set_status(&self, color: &str) {
        let rgba = make_colored_icon(color);
        let img = TauriImage::new(&rgba, 32, 32);
        let _ = self.tray.set_icon(Some(img));
    }

    pub fn set_menu_texts(&self, queue_text: &str, wf_text: &str) {
        let _ = self.queue_status.set_text(queue_text);
        let _ = self.wf_status.set_text(wf_text);
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
