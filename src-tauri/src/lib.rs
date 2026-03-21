mod settings;

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

/// 托盘菜单项引用，用于运行时更新文本
struct TrayMenuState {
    show: MenuItem<tauri::Wry>,
    topmost: CheckMenuItem<tauri::Wry>,
    autostart: CheckMenuItem<tauri::Wry>,
    check_update: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

fn tray_text(lang: &str, key: &str) -> &'static str {
    match (lang, key) {
        ("en", "show") => "Show Window",
        ("en", "topmost") => "Always on Top",
        ("en", "autostart") => "Launch at Startup",
        ("en", "check_update") => "Check for Updates",
        ("en", "quit") => "Quit",
        (_, "show") => "显示主窗口",
        (_, "topmost") => "置顶显示",
        (_, "autostart") => "开机启动",
        (_, "check_update") => "检查更新",
        (_, "quit") => "退出",
        _ => "",
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ==================== Tauri Commands ====================

#[tauri::command]
fn update_tray_language(app: tauri::AppHandle, language: String) {
    let lang = if language.starts_with("en") { "en" } else { "zh" };
    if let Some(state) = app.try_state::<TrayMenuState>() {
        let _ = state.show.set_text(tray_text(lang, "show"));
        let _ = state.topmost.set_text(tray_text(lang, "topmost"));
        let _ = state.autostart.set_text(tray_text(lang, "autostart"));
        let _ = state.check_update.set_text(tray_text(lang, "check_update"));
        let _ = state.quit.set_text(tray_text(lang, "quit"));
    }
}

#[tauri::command]
fn set_topmost(app: tauri::AppHandle, topmost: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(topmost);
    }
    if let Some(state) = app.try_state::<TrayMenuState>() {
        let _ = state.topmost.set_checked(topmost);
    }
}

#[tauri::command]
fn load_settings() -> Result<settings::AppSettings, String> {
    settings::load_settings()
}

#[tauri::command]
fn save_settings(settings_data: settings::AppSettings) -> Result<(), String> {
    settings::save_settings(&settings_data)
}

#[tauri::command]
fn get_config_dir() -> Result<String, String> {
    settings::get_config_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn is_startup_launch() -> bool {
    std::env::args().any(|a| a == "--startup")
}

// ==================== App Entry ====================

pub fn run() {
    // 早期加载设置（窗口创建前）
    let saved = settings::load_settings().unwrap_or_default();
    let is_startup = std::env::args().any(|a| a == "--startup");
    let should_hide = is_startup && saved.hide_to_tray_on_startup;
    let init_lang = if saved.language.starts_with("en") { "en" } else { "zh" };
    let init_topmost = saved.topmost;

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--startup"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            update_tray_language,
            set_topmost,
            load_settings,
            save_settings,
            get_config_dir,
            is_startup_launch,
        ])
        .setup(move |app| {
            // 托盘菜单
            let show = MenuItem::with_id(app, "show", tray_text(init_lang, "show"), true, None::<&str>)?;
            let topmost = CheckMenuItem::with_id(app, "topmost", tray_text(init_lang, "topmost"), true, init_topmost, None::<&str>)?;

            // 检查 OS 自启动状态
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart = CheckMenuItem::with_id(app, "autostart", tray_text(init_lang, "autostart"), true, autostart_enabled, None::<&str>)?;

            let check_update = MenuItem::with_id(app, "check_update", tray_text(init_lang, "check_update"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", tray_text(init_lang, "quit"), true, None::<&str>)?;

            let menu = Menu::with_items(app, &[
                &show,
                &PredefinedMenuItem::separator(app)?,
                &topmost,
                &autostart,
                &PredefinedMenuItem::separator(app)?,
                &check_update,
                &quit,
            ])?;

            let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("毛泽东生平地理轨迹")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "show" => show_main_window(app),
                        "topmost" => {
                            if let Some(w) = app.get_webview_window("main") {
                                if let Some(state) = app.try_state::<TrayMenuState>() {
                                    let checked = state.topmost.is_checked().unwrap_or(false);
                                    let _ = w.set_always_on_top(checked);
                                    let _ = w.emit("topmost-changed", checked);
                                }
                            }
                        }
                        "autostart" => {
                            if let Some(state) = app.try_state::<TrayMenuState>() {
                                let checked = state.autostart.is_checked().unwrap_or(false);
                                let result = if checked {
                                    app.autolaunch().enable()
                                } else {
                                    app.autolaunch().disable()
                                };
                                if result.is_err() {
                                    let _ = state.autostart.set_checked(!checked);
                                }
                                let _ = app.emit("autostart-changed", checked);
                            }
                        }
                        "check_update" => {
                            show_main_window(app);
                            let _ = app.emit("check-update", ());
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            app.manage(TrayMenuState { show, topmost, autostart, check_update, quit });

            // 设置窗口图标（任务栏高清图标）
            if let Some(w) = app.get_webview_window("main") {
                let win_icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;
                let _ = w.set_icon(win_icon);
            }

            // 应用初始置顶状态
            if init_topmost {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_always_on_top(true);
                }
            }

            // 开机启动时隐藏窗口
            if should_hide {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮 → 隐藏到托盘
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
