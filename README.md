# FFStudio

**FFStudio** is a cross-platform desktop application for visually designing, executing, and managing advanced FFmpeg video/audio processing workflows. It features a modern node-based editor, timeline, and integrated player, making complex FFmpeg tasks accessible to everyone.

---

## Features

- **Visual Workflow Editor:** Drag-and-drop node-based editor for FFmpeg pipelines.
- **Workflow Management:** Create, edit, and organize multiple workflows.
- **Integrated Timeline & Player:** Select, preview, and fine-tune video/audio segments.
- **Execution Logs:** Real-time logs for FFmpeg execution and workflow actions.
- **FFmpeg Integration:** Auto-discovers codecs, filters, and options from your FFmpeg binary.
- **Cross-Platform:** Available for Windows and Linux (deb package).

---

## App Overview

FFStudio lets you:
- Build processing pipelines visually by connecting nodes (inputs, filters, codecs, outputs).
- Manage and switch between multiple workflows for different tasks.
- Preview and edit segments using a timeline and player.
- Execute and monitor FFmpeg jobs with real-time feedback and logs.

### Main UI Areas
- **Top Bar:** App title, tab navigation (Graph, Player, Logs).
- **Main Area:**
  - **Graph:** Node-based editor for building FFmpeg graphs.
  - **Player:** Video/audio player with timeline and segment controls.
  - **Logs:** Execution and debug logs.
- **Right Sidebar:** Workflow management (list, add, edit, delete, select, execute).
- **Modals:** For workflow creation/editing and progress feedback.

---

## Download & Installation

### Windows
- Download the latest Windows installer (`.exe`) from the [Releases](https://github.com/Draver93/ff-studio/releases) page.
- Run the installer and follow the on-screen instructions.

### Linux (Debian/Ubuntu)
- Download the latest `.deb` package from the [Releases](https://github.com/Draver93/ff-studio/releases) page.
- Install via terminal:
  ```sh
  sudo dpkg -i ffstudio_VERSION_amd64.deb
  ```
- Launch FFStudio from your applications menu.

> **Note:** You must have [FFmpeg](https://ffmpeg.org/) installed on your system.

---

## Technology Stack
- **Frontend:** Vanilla JavaScript, HTML5, CSS3, LiteGraph.js, FontAwesome
- **Backend:** Tauri (Rust)
- **FFmpeg:** User-supplied binary

---

## License

FFStudio is **proprietary software** by Finoshkin Aleksei (2025).

- You are allowed to **download, install, and use** FFStudio for **personal, non-commercial purposes only**.
- Redistribution, modification, or commercial use is **prohibited** without prior written permission.
- For full license details, see [LICENSE](./LICENSE).
- For commercial licensing or inquiries, contact: alexeyf.160620@gmail.com

---

## Contact & Support

For bug reports, feature requests, or commercial licensing, please open an issue or email: alexeyf.160620@gmail.com

---
