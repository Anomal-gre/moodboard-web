use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use tauri::Manager;

const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;
const DESIGN_EXTENSIONS: &[&str] = &[
    "dwg", "dxf", "skp", "3dm", "rvt", "ifc", "pln", "vwx", "step", "stp", "iges", "igs",
    "psd", "psb", "ai", "indd", "idml", "blend", "max", "fbx", "obj", "mtl", "dgn",
];

#[cfg(target_os = "windows")]
fn launch_os_default(path: &Path) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            window: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> *mut c_void;
    }

    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // The path points to a freshly written application-owned document.
    let result = unsafe {
        ShellExecuteW(std::ptr::null_mut(), null(), file.as_ptr(), null(), null(), 1)
    };
    if result as usize <= 32 {
        return Err("Windows không thể mở tệp thiết kế.".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_os_default(path: &Path) -> Result<(), String> {
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(opener)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Không thể mở tệp thiết kế: {error}"))
}

fn design_file_name(name: &str) -> Result<String, String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let cleaned = cleaned.trim();
    let extension = Path::new(cleaned)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if cleaned.len() > 240 || !DESIGN_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Định dạng tệp không hỗ trợ mở trực tiếp.".into());
    }
    Ok(format!("mosa-{cleaned}"))
}

#[tauri::command]
fn open_file_bytes(app: tauri::AppHandle, file_name: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err("Tệp vượt quá giới hạn mở trực tiếp.".into());
    }
    let file_name = design_file_name(&file_name)?;
    let cache = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("documents");
    fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    static NEXT_FILE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let sequence = NEXT_FILE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let folder = cache.join(format!("{}-{timestamp}-{sequence}", std::process::id()));
    fs::create_dir(&folder).map_err(|error| error.to_string())?;
    let path = folder.join(file_name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    drop(file);
    launch_os_default(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_file_bytes])
        .run(tauri::generate_context!())
        .expect("Lỗi khi khởi chạy phần mềm Mosa Desktop");
}
