"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import {
  DiskItem,
  scanDirectory,
  formatBytes,
  getColorForSize,
  ScanOptions,
} from "@/lib/disk-utils";
import ScanProgress from "./scan-progress";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, RefreshCw } from "lucide-react";

interface TreemapData {
  name: string;
  value: number;
  path: string;
  itemStyle?: {
    color: string;
  };
  children?: TreemapData[];
}

// Define types for echarts parameters
interface EChartsParam {
  data: {
    name: string;
    value: number;
    path: string;
    children?: TreemapData[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
  event?: {
    preventDefault?: () => void;
    type?: string;
  };
}

export default function TreemapVisualizer({ path }: { path: string }) {
  const [data, setData] = useState<DiskItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>(path);
  const [depth, setDepth] = useState<number>(2);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanMode, setScanMode] = useState<"fast" | "comprehensive">("fast");
  const [skipHidden, setSkipHidden] = useState<boolean>(true);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [scanEndTime, setScanEndTime] = useState<number | null>(null);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [pathBreadcrumbs, setPathBreadcrumbs] = useState<
    { name: string; path: string }[]
  >([]);

  const chartRef = useRef<ReactECharts>(null);

  const fetchData = useCallback(
    async (pathToScan: string) => {
      try {
        setLoading(true);
        setError(null);
        setIsScanning(true);
        setScanStartTime(Date.now());
        setScanEndTime(null);

        // Create scan options based on user selections
        const scanOptions: ScanOptions = {
          fast_mode: scanMode === "fast",
          skip_hidden: skipHidden,
        };

        const result = await scanDirectory(pathToScan, depth, scanOptions);
        setData(result);
        setScanEndTime(Date.now());

        // Update breadcrumbs
        updateBreadcrumbs(pathToScan);
      } catch (err) {
        setError(
          "Failed to scan directory: " +
            (err instanceof Error ? err.message : String(err))
        );
        console.error(err);
      } finally {
        setLoading(false);
        setIsScanning(false);
      }
    },
    [depth, scanMode, skipHidden]
  );

  // Listen for events from Tauri backend
  useEffect(() => {
    const handleDeleteEvent = () => {
      fetchData(currentPath);
    };

    // Create a simple event listener since we don't have proper Tauri event api
    const setupListener = () => {
      document.addEventListener(
        "delete-confirmed",
        handleDeleteEvent as EventListener
      );
    };

    setupListener();

    return () => {
      document.removeEventListener(
        "delete-confirmed",
        handleDeleteEvent as EventListener
      );
    };
  }, [currentPath, fetchData]);

  const updateBreadcrumbs = (pathToScan: string) => {
    const parts = pathToScan.split(/[/\\]/);
    const breadcrumbs = [];

    // Handle Windows drive letters specially
    if (parts[0].includes(":")) {
      breadcrumbs.push({
        name: parts[0],
        path: parts[0] + "\\",
      });
      parts.shift();
    } else if (parts[0] === "") {
      // Unix root directory
      breadcrumbs.push({
        name: "/",
        path: "/",
      });
      parts.shift();
    }

    let currentPath = breadcrumbs.length > 0 ? breadcrumbs[0].path : "";

    for (const part of parts.filter((p) => p)) {
      currentPath =
        currentPath.endsWith("/") || currentPath.endsWith("\\")
          ? currentPath + part
          : currentPath + "/" + part;

      breadcrumbs.push({
        name: part,
        path: currentPath,
      });
    }

    setPathBreadcrumbs(breadcrumbs);
  };

  useEffect(() => {
    if (currentPath) {
      fetchData(currentPath);
    }
  }, [currentPath, depth, scanMode, skipHidden, fetchData]);

  const getScanDuration = () => {
    if (scanStartTime && scanEndTime) {
      const durationMs = scanEndTime - scanStartTime;
      return (durationMs / 1000).toFixed(2);
    }
    return null;
  };

  const transformToTreemap = (item: DiskItem, maxSize: number): TreemapData => {
    const result: TreemapData = {
      name: item.name,
      value: item.size,
      path: item.path,
      itemStyle: {
        color: getColorForSize(item.size, maxSize),
      },
    };

    if (item.children && item.children.length > 0) {
      const childrenMaxSize = item.children.reduce(
        (max, child) => Math.max(max, child.size),
        0
      );

      result.children = item.children.map((child) =>
        transformToTreemap(child, childrenMaxSize)
      );
    }

    return result;
  };

  const option = data
    ? {
        tooltip: {
          formatter: (params: EChartsParam) => {
            const { name, value, path } = params.data;
            return `${name}<br/>Size: ${formatBytes(value)}<br/>Path: ${path}`;
          },
        },
        series: [
          {
            type: "treemap",
            data: [transformToTreemap(data, data.size)],
            width: "100%",
            height: "100%",
            roam: false,
            nodeClick: "link",
            breadcrumb: {
              show: false, // We'll use our own breadcrumbs
            },
            label: {
              show: true,
              formatter: "{b}",
              fontSize: 14,
            },
            upperLabel: {
              show: true,
              height: 30,
              formatter: (params: EChartsParam) => {
                return formatBytes(params.value as number);
              },
            },
            emphasis: {
              label: {
                show: true,
                fontSize: 16,
                fontWeight: "bold",
              },
            },
            animationDurationUpdate: 500,
          },
        ],
      }
    : {};

  const handleClick = (params: EChartsParam) => {
    if (params?.data?.path && params?.data?.children) {
      // Save current path to history before changing
      setPathHistory((prev) => [...prev, currentPath]);
      setCurrentPath(params.data.path);
    }
  };

  const handleContextMenu = (params: EChartsParam) => {
    if (params?.data?.path) {
      // Prevent default context menu if event exists
      if (params.event && typeof params.event.preventDefault === "function") {
        params.event.preventDefault();
      }

      // Use Tauri's invoke to show a native context menu
      invoke("show_file_context_menu", {
        path: params.data.path,
        fileName: params.data.name,
        isDir: !!params.data.children,
        windowLabel: "main", // Using default window label
      }).catch((err) => {
        console.error("Failed to show context menu:", err);
      });
    }
  };

  const navigateBack = () => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1];
      setPathHistory((prev) => prev.slice(0, -1));
      setCurrentPath(previousPath);
    }
  };

  const navigateToBreadcrumb = (path: string) => {
    // Save current path to history before changing
    setPathHistory((prev) => [...prev, currentPath]);
    setCurrentPath(path);
  };

  const handleDepthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDepth(parseInt(e.target.value, 10));
  };

  const handleScanModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setScanMode(e.target.value as "fast" | "comprehensive");
  };

  const handleSkipHiddenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSkipHidden(e.target.checked);
  };

  return (
    <div className="p-4 relative">
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={navigateBack}
            disabled={pathHistory.length === 0}
            className={`p-2 rounded ${
              pathHistory.length === 0
                ? "text-gray-400 cursor-not-allowed"
                : "text-blue-600 hover:bg-blue-50"
            }`}
            title="Go back"
          >
            <ArrowLeft size={18} />
          </button>

          <button
            onClick={() => fetchData(currentPath)}
            className="p-2 rounded text-blue-600 hover:bg-blue-50"
            title="Refresh"
            disabled={isScanning || loading}
          >
            <RefreshCw className={isScanning ? "animate-spin" : ""} size={18} />
          </button>

          <div className="flex flex-wrap items-center bg-gray-100 px-2 py-1 rounded-md overflow-x-auto max-w-full">
            {pathBreadcrumbs.map((crumb, index) => (
              <div key={crumb.path} className="flex items-center">
                {index > 0 && <span className="mx-1 text-gray-500">/</span>}
                <button
                  onClick={() => navigateToBreadcrumb(crumb.path)}
                  className="px-1 py-0.5 text-sm hover:bg-blue-100 rounded truncate max-w-[150px]"
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mr-4">
          <h2 className="text-xl font-bold">Directory Analysis (Treemap)</h2>
          <p className="text-sm text-gray-600">{currentPath}</p>
          {getScanDuration() && (
            <p className="text-xs text-gray-500">
              Scan completed in {getScanDuration()} seconds
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <div>
            <label htmlFor="treemap-depth" className="block text-sm mb-1">
              Scan Depth:
            </label>
            <select
              id="treemap-depth"
              value={depth}
              onChange={handleDepthChange}
              className="border rounded p-2 text-sm w-full"
              disabled={isScanning || loading}
            >
              <option value="1">1 Level</option>
              <option value="2">2 Levels</option>
              <option value="3">3 Levels</option>
              <option value="4">4 Levels</option>
            </select>
          </div>

          <div>
            <label htmlFor="treemap-scan-mode" className="block text-sm mb-1">
              Scan Mode:
            </label>
            <select
              id="treemap-scan-mode"
              value={scanMode}
              onChange={handleScanModeChange}
              className="border rounded p-2 text-sm w-full"
              disabled={isScanning || loading}
            >
              <option value="fast">Fast</option>
              <option value="comprehensive">Comprehensive</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={skipHidden}
                onChange={handleSkipHiddenChange}
                className="mr-2"
                disabled={isScanning || loading}
              />
              Skip Hidden Files
            </label>
          </div>
        </div>
      </div>

      {loading && !isScanning && (
        <div className="p-4 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p>Preparing scan...</p>
        </div>
      )}

      {error && (
        <div className="p-4 text-red-500 border border-red-300 rounded-md bg-red-50">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="bg-blue-50 border border-blue-200 p-3 rounded-md mb-4 text-sm">
            <div className="font-semibold">Scan Results</div>
            <div className="flex flex-wrap gap-x-8 gap-y-2 mt-1">
              <div>
                <span className="font-medium">Total Size:</span>{" "}
                {formatBytes(data.size)}
              </div>
              <div>
                <span className="font-medium">Children:</span>{" "}
                {data.children?.length || 0}
              </div>
              <div>
                <span className="font-medium">Mode:</span> {scanMode} scan
              </div>
              <div>
                <span className="font-medium">Scan Time:</span>{" "}
                {getScanDuration() || "..."} seconds
              </div>
            </div>
          </div>

          <div className="h-[600px] w-full relative">
            <ReactECharts
              ref={chartRef}
              option={option}
              style={{ height: "100%", width: "100%" }}
              onEvents={{
                click: handleClick,
                contextmenu: handleContextMenu,
              }}
            />
          </div>
        </>
      )}

      {/* Progress bar component */}
      <ScanProgress isScanning={isScanning} />
    </div>
  );
}
