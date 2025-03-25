import { invoke } from "@tauri-apps/api/core";

export interface DiskItem {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  children?: DiskItem[];
}

export interface DriveInfo {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
  used_space: number;
}

export interface ScanOptions {
  fast_mode: boolean;
  skip_hidden: boolean;
}

export async function scanDirectory(
  path: string,
  depth: number = 2,
  options: ScanOptions = { fast_mode: true, skip_hidden: true }
): Promise<DiskItem> {
  try {
    return await invoke("scan_directory", { path, depth, options });
  } catch (error) {
    console.error("Error scanning directory:", error);
    throw error;
  }
}

export async function getDriveInfo(): Promise<DriveInfo[]> {
  try {
    return await invoke("get_drive_info");
  } catch (error) {
    console.error("Error getting drive info:", error);
    throw error;
  }
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function getColorForSize(size: number, maxSize: number): string {
  // Calculate a color based on the relative size (red for largest, blue for smallest)
  const ratio = size / maxSize;

  // Colors from blue (small) to red (large)
  const colors = [
    "#3b82f6", // blue
    "#60a5fa",
    "#93c5fd",
    "#6366f1", // indigo
    "#a855f7", // purple
    "#d946ef", // fuchsia
    "#ec4899", // pink
    "#f43f5e", // rose
    "#ef4444", // red
  ];

  const index = Math.min(Math.floor(ratio * colors.length), colors.length - 1);
  return colors[index];
}
