use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const APP_DIR_NAME: &str = ".mao-map";
const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub launch_at_startup: bool,
    #[serde(default)]
    pub hide_to_tray_on_startup: bool,
    #[serde(default)]
    pub topmost: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "zh-CN".to_string(),
            launch_at_startup: false,
            hide_to_tray_on_startup: false,
            topmost: false,
        }
    }
}

/// 获取配置目录 ~/.mao-map/，不存在则创建
pub fn get_config_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let dir = home.join(APP_DIR_NAME);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    Ok(dir)
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(get_config_dir()?.join(SETTINGS_FILE))
}

pub fn load_settings() -> Result<AppSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("读取设置失败: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("解析设置失败: {e}"))
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("序列化设置失败: {e}"))?;
    fs::write(&tmp, &data).map_err(|e| format!("写入设置失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存设置失败: {e}"))?;
    Ok(())
}
