use dunce::canonicalize;
use fs_extra::dir::get_size;
use log::error;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::command;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use walkdir::WalkDir;
use tauri_plugin_fs;
use tauri_plugin_opener;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiskItem {
    name: String,
    path: String,
    size: u64,
    is_dir: bool,
    children: Option<Vec<DiskItem>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanProgress {
    current_path: String,
    processed_items: usize,
    total_items: usize,
    percent: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanOptions {
    fast_mode: bool,
    skip_hidden: bool,
}

// Directories to skip on Windows to avoid permission issues
#[cfg(target_os = "windows")]
const SKIP_DIRS: [&str; 8] = [
    r"c:\$recycle.bin",
    r"c:\config.msi",
    r"c:\system volume information",
    r"c:\windows",
    r"c:\programdata\packages",
    r"c:\programdata\tailscale",
    r"c:\programdata\windowsholographicdevices",
    r"c:\document and settings",
];

#[command]
async fn scan_directory(
    app: tauri::AppHandle,
    path: String,
    depth: Option<usize>,
    options: Option<ScanOptions>,
) -> Result<DiskItem, String> {
    let max_depth = depth.unwrap_or(2);
    let options = options.unwrap_or(ScanOptions {
        fast_mode: true,
        skip_hidden: true,
    });
    
    let path = Path::new(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    let canonical_path = match canonicalize(path) {
        Ok(p) => p,
        Err(e) => return Err(format!("Failed to canonicalize path: {}", e)),
    };

    let name = canonical_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| canonical_path.to_string_lossy().to_string());

    // Create progress tracking
    let processed_items = Arc::new(AtomicUsize::new(0));
    let total_items = estimate_item_count(&canonical_path, max_depth);
    
    // Initial progress report
    emit_progress(
        &app,
        &canonical_path,
        processed_items.load(Ordering::SeqCst),
        total_items,
    );

    // Perform the actual scan using new efficient algorithm
    let result = if options.fast_mode {
        // Fast scan - parallel processing with estimation for large dirs
        fast_scan(
            &canonical_path,
            max_depth,
            &app,
            &processed_items,
            total_items,
            &options,
        )
    } else {
        // Comprehensive scan - accurate sizes but slower
        comprehensive_scan(
            &canonical_path,
            max_depth,
            &app,
            &processed_items,
            total_items,
            &options,
        )
    };

    // Final progress report
    emit_progress(&app, &canonical_path, total_items, total_items);

    Ok(result)
}

// Helper function to emit progress updates
fn emit_progress(
    app: &tauri::AppHandle,
    path: &Path,
    processed: usize,
    total: usize,
) {
    let percent = if total > 0 {
        (processed as f32 / total as f32) * 100.0
    } else {
        0.0
    };

    let progress = ScanProgress {
        current_path: path.to_string_lossy().to_string(),
        processed_items: processed,
        total_items: total,
        percent,
    };

    let _ = app.emit("scan-progress", &progress);
}

// Fast scan uses parallel processing and estimates sizes for large directories
fn fast_scan(
    dir_path: &Path,
    max_depth: usize,
    app: &tauri::AppHandle,
    processed_items: &Arc<AtomicUsize>,
    total_items: usize,
    options: &ScanOptions,
) -> DiskItem {
    let mut root = DiskItem {
        name: dir_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| dir_path.to_string_lossy().to_string()),
        path: dir_path.to_string_lossy().to_string(),
        size: 0,
        is_dir: true,
        children: Some(Vec::new()),
    };

    // Process all entries in the directory
    if let Ok(entries) = std::fs::read_dir(dir_path) {
        let entries: Vec<_> = entries.filter_map(Result::ok).collect();

        // Extract file entries first (quick to process)
        let mut children: Vec<DiskItem> = entries
            .iter()
            .filter_map(|entry| {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                
                // Skip hidden files if configured
                if options.skip_hidden && name.starts_with(".") {
                    return None;
                }
                
                if path.is_file() {
                    // Update progress
                    let current = processed_items.fetch_add(1, Ordering::SeqCst) + 1;
                    if current % 100 == 0 || current < 100 {
                        emit_progress(app, &path, current, total_items);
                    }
                    
                    // Get file size
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    
                    Some(DiskItem {
                        name,
                        path: path.to_string_lossy().to_string(),
                        size,
                        is_dir: false,
                        children: None,
                    })
                } else {
                    None
                }
            })
            .collect();

        // Then process directories in parallel
        let dirs: Vec<_> = entries
            .iter()
            .filter(|entry| entry.path().is_dir())
            .collect();

        // Skip system directories that cause permission issues
        #[cfg(target_os = "windows")]
        let dirs: Vec<_> = dirs
            .into_iter()
            .filter(|entry| {
                let path = entry.path().to_string_lossy().to_lowercase();
                !SKIP_DIRS.iter().any(|skip| path.starts_with(skip))
            })
            .collect();

        // Process directories in parallel if we're not at max depth
        if max_depth > 0 {
            let dir_items: Vec<DiskItem> = if dirs.len() > 0 {
                // Use Rayon's parallel iterator for directories
                dirs.par_iter()
                    .filter_map(|entry| {
                        let path = entry.path();
                        let name = entry.file_name().to_string_lossy().to_string();
                        
                        // Skip hidden directories if configured
                        if options.skip_hidden && name.starts_with(".") {
                            return None;
                        }
                        
                        // Update progress
                        let current = processed_items.fetch_add(1, Ordering::SeqCst) + 1;
                        if current % 20 == 0 || current < 100 {
                            emit_progress(app, &path, current, total_items);
                        }
                        
                        // For large directories with many files, we might skip full scan in fast mode
                        let skip_full_scan = options.fast_mode && is_large_directory(&path);
                        
                        if skip_full_scan && max_depth > 1 {
                            // For large directories, just estimate size rather than scan fully
                            let size = estimate_dir_size(&path);
                            Some(DiskItem {
                                name,
                                path: path.to_string_lossy().to_string(),
                                size,
                                is_dir: true,
                                children: Some(vec![]), // Empty children since we're skipping full scan
                            })
                        } else {
                            // Regular recursive scan for normal directories
                            Some(fast_scan(
                                &path,
                                max_depth - 1,
                                app,
                                processed_items,
                                total_items,
                                options,
                            ))
                        }
                    })
                    .collect()
            } else {
                Vec::new()
            };

            // Combine file and directory results
            children.extend(dir_items);
        } else {
            // At max depth, just add directories as leaves without children
            for entry in dirs {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                
                // Skip hidden directories if configured
                if options.skip_hidden && name.starts_with(".") {
                    continue;
                }
                
                // Update progress
                let current = processed_items.fetch_add(1, Ordering::SeqCst) + 1;
                if current % 20 == 0 || current < 100 {
                    emit_progress(app, &path, current, total_items);
                }
                
                // Estimate size without recursing
                let size = estimate_dir_size(&path);
                
                children.push(DiskItem {
                    name,
                    path: path.to_string_lossy().to_string(),
                    size,
                    is_dir: true,
                    children: Some(Vec::new()),
                });
            }
        }

        // Sort children by size (largest first)
        children.sort_by(|a, b| b.size.cmp(&a.size));
        
        // Set children and calculate root size as sum of children
        root.children = Some(children);
        if let Some(children) = &root.children {
            root.size = children.iter().map(|child| child.size).sum();
        }
    }

    root
}

// Check if a directory is "large" (contains many files)
fn is_large_directory(path: &Path) -> bool {
    let mut count = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for _ in entries.take(1000) {
            count += 1;
            if count >= 1000 {
                return true;
            }
        }
    }
    false
}

// Quickly estimate directory size (faster than full scan)
fn estimate_dir_size(path: &Path) -> u64 {
    // Try the accurate method first with a file count limit
    if let Ok(metadata) = std::fs::metadata(path) {
        // On some platforms, we might get the directory size directly
        let size = metadata.len();
        if size > 0 {
            return size;
        }
    }
    
    // Sample-based estimation for large directories
    let mut size = 0;
    let mut count = 0;
    let mut sample_count = 0;
    
    if let Ok(entries) = std::fs::read_dir(path) {
        // First pass: count entries and take size samples
        for entry_result in entries.take(100) {
            if let Ok(entry) = entry_result {
                count += 1;
                if let Ok(metadata) = entry.metadata() {
                    size += metadata.len();
                    sample_count += 1;
                }
            }
        }
    }
    
    // Try to count all entries but limit to prevent slow performance
    let total_count = if let Ok(entries) = std::fs::read_dir(path) {
        entries.count().min(10000)
    } else {
        count
    };
    
    // If we have samples, extrapolate total size
    if sample_count > 0 && total_count > sample_count {
        let avg_size = size as f64 / sample_count as f64;
        (avg_size * total_count as f64) as u64
    } else {
        // Fallback to sum of sample sizes
        size
    }
}

// Comprehensive scan - more accurate but slower
fn comprehensive_scan(
    dir_path: &Path,
    max_depth: usize,
    app: &tauri::AppHandle,
    processed_items: &Arc<AtomicUsize>,
    total_items: usize,
    options: &ScanOptions,
) -> DiskItem {
    let path_str = dir_path.to_string_lossy().to_lowercase();
    
    // Skip certain system directories that typically cause "Access denied" errors
    #[cfg(target_os = "windows")]
    for skip_dir in &SKIP_DIRS {
        if path_str.starts_with(skip_dir) {
            return DiskItem {
                name: format!("{} (access denied)", dir_path.file_name().unwrap_or_default().to_string_lossy()),
                path: dir_path.to_string_lossy().to_string(),
                size: 0,
                is_dir: true,
                children: None,
            };
        }
    }
    
    let mut root = DiskItem {
        name: dir_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| dir_path.to_string_lossy().to_string()),
        path: dir_path.to_string_lossy().to_string(),
        size: 0,
        is_dir: true,
        children: Some(Vec::new()),
    };
    
    // Update progress
    let current = processed_items.fetch_add(1, Ordering::SeqCst) + 1;
    if current % 20 == 0 || current < 100 {
        emit_progress(app, dir_path, current, total_items);
    }
    
    // Create a walkdir iterator with error handling
    let walker = WalkDir::new(dir_path)
        .min_depth(1)
        .max_depth(1)
        .follow_links(false);
    
    let mut children = Vec::new();
    
    for entry_result in walker {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(e) => {
                // Log access denied errors at debug level, not error level
                if e.to_string().contains("Access is denied") {
                    log::debug!("Access denied: {}", e);
                } else {
                    error!("Error accessing entry: {}", e);
                }
                continue;
            }
        };
        
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().is_dir();
        
        // Skip hidden files/dirs if configured
        if options.skip_hidden && name.starts_with(".") {
            continue;
        }
        
        let size = if is_dir {
            // For directories, calculate size based on accurate method for comprehensive scan
            match get_size(path) {
                Ok(size) => size,
                Err(_) => {
                    // If we can't get the size, set it to 0 and continue
                    0
                }
            }
        } else {
            match path.metadata() {
                Ok(metadata) => metadata.len(),
                Err(_) => 0,
            }
        };
        
        let mut child = DiskItem {
            name,
            path: path.to_string_lossy().to_string(),
            size,
            is_dir,
            children: if is_dir { Some(Vec::new()) } else { None },
        };
        
        // Update progress for this entry
        let current = processed_items.fetch_add(1, Ordering::SeqCst) + 1;
        if current % 20 == 0 || current < 100 {
            emit_progress(app, path, current, total_items);
        }
        
        if is_dir && max_depth > 0 {
            // Recursively scan subdirectory
            child = comprehensive_scan(path, max_depth - 1, app, processed_items, total_items, options);
        }
        
        children.push(child);
    }
    
    // Sort children by size (largest first)
    children.sort_by(|a, b| b.size.cmp(&a.size));
    
    // Set children and calculate root size as sum of children
    if !children.is_empty() {
        root.size = children.iter().map(|child| child.size).sum();
        root.children = Some(children);
    }
    
    root
}

// Function to estimate the total number of items to scan
fn estimate_item_count(path: &Path, max_depth: usize) -> usize {
    if !path.is_dir() {
        return 1;
    }
    
    // For large directories, limit the estimation to avoid slowdowns
    if is_large_directory(path) {
        return 5000; // Just use a reasonable estimate
    }
    
    let mut count = 1; // Count the directory itself
    
    // Only count immediate children for estimation to avoid too much overhead
    if let Ok(entries) = path.read_dir() {
        for entry_result in entries {
            if let Ok(entry) = entry_result {
                count += 1;
                
                // Only recurse for a limited depth to keep estimation fast
                if max_depth > 0 && entry.path().is_dir() {
                    // Avoid estimating too deeply to keep it responsive
                    let subdepth = if max_depth > 2 { 0 } else { max_depth - 1 };
                    count += estimate_item_count(&entry.path(), subdepth);
                }
            }
        }
    }
    
    count
}

#[command]
async fn get_drive_info() -> Result<Vec<DriveInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        get_windows_drives()
    }
    #[cfg(not(target_os = "windows"))]
    {
        get_unix_drives()
    }
}

#[derive(Debug, Serialize)]
pub struct DriveInfo {
    name: String,
    mount_point: String,
    total_space: u64,
    available_space: u64,
    used_space: u64,
}

#[cfg(target_os = "windows")]
fn get_windows_drives() -> Result<Vec<DriveInfo>, String> {
    use std::ffi::OsString;
    use std::fs;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::prelude::OsStringExt;
    use winapi::shared::minwindef::DWORD;
    use winapi::um::fileapi::GetDiskFreeSpaceExW;
    use winapi::um::winnt::ULARGE_INTEGER;
    
    let mut drives = Vec::new();
    
    for drive in 'A'..='Z' {
        let drive_path = format!("{}:\\", drive);
        let path = Path::new(&drive_path);
        
        if path.exists() {
            if let Ok(metadata) = fs::metadata(path) {
                // Skip CD-ROM drives and other special drives
                if metadata.file_type().is_file() {
                    continue;
                }

                // Convert path to wide string (UTF-16)
                let wide_path: Vec<u16> = path
                    .as_os_str()
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect();

                let mut available_bytes = 0u64;
                let mut total_bytes = 0u64;
                let mut free_bytes = 0u64;

                // Call Windows API
                let result = unsafe {
                    GetDiskFreeSpaceExW(
                        wide_path.as_ptr(),
                        &mut available_bytes as *mut u64 as *mut ULARGE_INTEGER,
                        &mut total_bytes as *mut u64 as *mut ULARGE_INTEGER,
                        &mut free_bytes as *mut u64 as *mut ULARGE_INTEGER,
                    )
                };

                if result != 0 {
                    let used_space = total_bytes.saturating_sub(available_bytes);

                    if total_bytes > 0 {
                        drives.push(DriveInfo {
                            name: format!("Drive {}", drive),
                            mount_point: drive_path,
                            total_space: total_bytes,
                            available_space: available_bytes,
                            used_space,
                        });
                    }
                }
            }
        }
    }
    
    Ok(drives)
}

#[cfg(not(target_os = "windows"))]
fn get_unix_drives() -> Result<Vec<DriveInfo>, String> {
    use std::fs;
    use std::process::Command;
    
    let mut drives = Vec::new();
    
    let output = Command::new("df")
        .arg("-k")
        .output()
        .map_err(|e| format!("Failed to execute df: {}", e))?;
    
    let output_str = String::from_utf8_lossy(&output.stdout);
    
    for line in output_str.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 6 {
            continue;
        }
        
        let device = parts[0];
        let mount_point = parts[5];
        let path = Path::new(mount_point);
        
        if let Ok(total_space) = fs::metadata(path).map(|m| m.len()) {
            let available_space = parts[3].parse::<u64>().unwrap_or(0) * 1024;
            let used_space = parts[2].parse::<u64>().unwrap_or(0) * 1024;
            
            drives.push(DriveInfo {
                name: device.to_string(),
                mount_point: mount_point.to_string(),
                total_space,
                available_space,
                used_space,
            });
        }
    }
    
    Ok(drives)
}

#[command]
async fn show_file_context_menu(
    app: AppHandle,
    path: String,
    file_name: String,
    is_dir: bool,
    window_label: String
) -> Result<(), String> {
    let window = app.get_webview_window(&window_label)
        .ok_or_else(|| "Window not found".to_string())?;
    
    // Create menu items
    let open_item = MenuItemBuilder::with_id("open", format!("Open {}", if is_dir { "Folder" } else { "File" }))
        .build(&app)
        .map_err(|e| format!("Failed to build menu: {}", e))?;
    
    let delete_item = MenuItemBuilder::with_id("delete", format!("Delete {}", if is_dir { "Folder" } else { "File" }))
        .build(&app)
        .map_err(|e| format!("Failed to build menu: {}", e))?;
    
    let properties_item = MenuItemBuilder::with_id("properties", "Properties")
        .build(&app)
        .map_err(|e| format!("Failed to build menu: {}", e))?;
    
    // Build the menu
    let menu = MenuBuilder::new(&app)
        .items(&[&open_item, &delete_item, &properties_item])
        .build()
        .map_err(|e| format!("Failed to build menu: {}", e))?;
    
    // Clone path to use in the closure
    let path_clone = path.clone();
    
    // Clone app to avoid borrowing issues
    let app_clone = app.clone();
    
    // Register event handler before showing menu
    app.once("menu-event", move |event| {
        let menu_id = event.payload();
        match menu_id {
            "open" => {
                let _ = tauri_plugin_opener::open_path(path_clone.clone(), None::<&str>);
            },
            "delete" => {
                // Deletion will be handled by front-end after confirmation
                let _ = app_clone.emit("delete-requested", path_clone.clone());
            },
            "properties" => {
                #[cfg(target_os = "windows")]
                {
                    use std::process::Command;
                    let _ = Command::new("cmd")
                        .args(&["/C", "explorer", "/select,", &path_clone])
                        .spawn();
                }
                
                #[cfg(not(target_os = "windows"))]
                {
                    // For other platforms, just open the containing folder as a fallback
                    if let Some(parent) = Path::new(&path_clone).parent() {
                        let _ = tauri_plugin_opener::open_path(parent.to_string_lossy().to_string(), None::<&str>);
                    }
                }
            },
            _ => {}
        }
    });

    Ok(())
}

#[command]
async fn open_path(path: String) -> Result<(), String> {
    match tauri_plugin_opener::open_path(path,  None::<&str>) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to open path: {}", e))
    }
}

#[command]
async fn delete_path(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    
    if path.is_dir() {
        match std::fs::remove_dir_all(path) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to delete directory: {}", e))
        }
    } else {
        match std::fs::remove_file(path) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to delete file: {}", e))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            get_drive_info,
            open_path,
            delete_path,
            show_file_context_menu
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
