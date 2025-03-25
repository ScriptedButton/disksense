"use client";

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface ScanProgressProps {
  isScanning: boolean;
}

interface ProgressData {
  current_path: string;
  processed_items: number;
  total_items: number;
  percent: number;
}

export default function ScanProgress({ isScanning }: ScanProgressProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [unlisten, setUnlisten] = useState<() => void | null>(() => null);

  useEffect(() => {
    let mounted = true;

    const setupListener = async () => {
      try {
        // Listen for scan progress events from the Rust backend
        const unlistenFn = await listen<ProgressData>(
          "scan-progress",
          (event) => {
            if (mounted) {
              setProgress(event.payload);
            }
          }
        );

        // Store the unlisten function to clean up later
        setUnlisten(() => unlistenFn);

        return unlistenFn;
      } catch (err) {
        console.error("Failed to setup event listener:", err);
        return () => {};
      }
    };

    // Only setup the listener if scanning is active
    if (isScanning) {
      setupListener();
    } else {
      // Reset progress when not scanning
      setProgress(null);
      // Clean up existing listener if any
      if (unlisten) {
        unlisten();
      }
    }

    return () => {
      mounted = false;
      // Clean up listener on component unmount
      if (unlisten) {
        unlisten();
      }
    };
  }, [isScanning, unlisten]);

  if (!isScanning || !progress) return null;

  // Truncate long paths for display
  const displayPath =
    progress.current_path.length > 60
      ? "..." +
        progress.current_path.substring(progress.current_path.length - 60)
      : progress.current_path;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white shadow-md border-t p-3 z-50">
      <div className="max-w-5xl mx-auto">
        <div className="mb-1 flex justify-between text-sm text-gray-600">
          <div className="truncate flex-1 mr-4">
            <span className="font-semibold">Scanning:</span> {displayPath}
          </div>
          <div className="whitespace-nowrap">
            {progress.processed_items} / {progress.total_items} items
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-in-out"
            style={{ width: `${Math.min(progress.percent, 100)}%` }}
          ></div>
        </div>
        <div className="mt-1 text-right text-xs text-gray-500">
          {progress.percent.toFixed(1)}% complete
        </div>
      </div>
    </div>
  );
}
