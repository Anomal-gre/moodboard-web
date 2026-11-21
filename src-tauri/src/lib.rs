use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn launch_os_default(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Không tìm thấy tệp tại đường dẫn: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Không thể mở tệp trên Windows: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Không thể mở tệp trên macOS: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Không thể mở tệp trên Linux: {}", e))?;
    }

    Ok(())
}

fn sanitize_file_name(name: &str) -> String {
    let fallback = "document.bin";
    let base = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(fallback);
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect();
    if cleaned.trim().is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

#[tauri::command]
fn open_file_native(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    launch_os_default(&target)
}

#[tauri::command]
fn open_file_bytes(
    #[allow(unused_variables)] file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let safe_name = sanitize_file_name(&file_name);
    let cache_dir = std::env::temp_dir().join("mosa_moodboard_files");
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Không thể tạo thư mục tạm: {}", e))?;

    let target_path = cache_dir.join(&safe_name);
    fs::write(&target_path, &bytes)
        .map_err(|e| format!("Không thể ghi tệp tạm để mở: {}", e))?;

    launch_os_default(&target_path)?;
    Ok(target_path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_file_native,
            open_file_bytes
        ])
        .run(tauri::generate_context!())
        .expect("Lỗi khi khởi chạy phần mềm Mosa Desktop");
}
