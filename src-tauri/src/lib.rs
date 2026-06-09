mod settings;

#[cfg(not(target_os = "android"))]
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    Emitter, Manager, WindowEvent,
};

#[cfg(not(target_os = "android"))]
use tauri_plugin_autostart::ManagerExt;

#[cfg(not(target_os = "android"))]
struct TrayMenuState {
    show: MenuItem<tauri::Wry>,
    topmost: CheckMenuItem<tauri::Wry>,
    autostart: CheckMenuItem<tauri::Wry>,
    check_update: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[cfg(not(target_os = "android"))]
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

#[cfg(not(target_os = "android"))]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ==================== Tauri Commands ====================

#[cfg(not(target_os = "android"))]
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

#[cfg(not(target_os = "android"))]
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

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn is_startup_launch() -> bool {
    std::env::args().any(|a| a == "--startup")
}

#[tauri::command]
async fn proxy_fetch(url: String) -> Result<String, String> {
    use base64::Engine;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("读取失败: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

// ==================== App Entry ====================


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    // 桌面端（Windows/macOS/Linux）：托盘、自启、置顶、关闭到托盘
    #[cfg(not(target_os = "android"))]
    let builder = setup_desktop(builder);

    // Android：仅注册跨平台命令（无托盘/窗口管理概念）
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        load_settings,
        save_settings,
        get_config_dir,
        proxy_fetch,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 桌面端初始化：托盘菜单、开机自启、窗口置顶、关闭隐藏到托盘等。
/// Android 无这些概念，故整体置于本函数并以 cfg 排除，使 run() 保持精简。
#[cfg(not(target_os = "android"))]
fn setup_desktop(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    // 早期加载设置（窗口创建前）
    let saved = settings::load_settings().unwrap_or_default();
    let is_startup = std::env::args().any(|a| a == "--startup");
    let should_hide = is_startup && saved.hide_to_tray_on_startup;
    let init_lang = if saved.language.starts_with("en") { "en" } else { "zh" };
    let init_topmost = saved.topmost;

    builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--startup"]),
        ))
        .invoke_handler(tauri::generate_handler![
            update_tray_language,
            set_topmost,
            load_settings,
            save_settings,
            get_config_dir,
            is_startup_launch,
            proxy_fetch,
        ])
        .setup(move |app| {
            let show = MenuItem::with_id(app, "show", tray_text(init_lang, "show"), true, None::<&str>)?;
            let topmost = CheckMenuItem::with_id(app, "topmost", tray_text(init_lang, "topmost"), true, init_topmost, None::<&str>)?;

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

            if let Some(w) = app.get_webview_window("main") {
                let win_icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;
                let _ = w.set_icon(win_icon);
            }

            if init_topmost {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_always_on_top(true);
                }
            }

            if should_hide {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
}
