# Contributing Guidelines

Thanks for your interest in contributing! 🦀✨  

## 🚀 Getting Started
1. **Fork** the repository and **clone** your fork.  
2. Install the Tauri app generator (if you haven’t):  
   ```bash
   cargo install create-tauri-app --locked
   ```
3. Run the project:  
   ```bash
   cargo tauri dev
   ```

## 🧩 Making Changes
1. Create a new branch for your change:  
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes and ensure the app builds:  
   ```bash
   cargo check
   cargo fmt
   ```
3. Commit with a clear message and push your branch.  
4. Open a **Pull Request** with a short description of what you changed.

## 🧭 Guidelines
- Follow Rust’s standard formatting and naming conventions.  
- Run `cargo fmt` and `cargo clippy` before committing.  
- Keep PRs small and focused.  

## 💬 Reporting Issues
Report bugs or suggest features via **GitHub Issues**. Please include:
- Steps to reproduce (if applicable)  
- Expected vs. actual behavior  
- Environment info (OS, Rust version, Tauri version)  
