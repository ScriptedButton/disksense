"use client";

import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import {
  DiskItem,
  scanDirectory,
  formatBytes,
  ScanOptions,
} from "@/lib/disk-utils";
import ScanProgress from "./scan-progress";

interface SunburstData {
  name: string;
  value?: number;
  path?: string;
  itemStyle?: {
    color: string;
  };
  children?: SunburstData[];
}

// Define types for echarts parameters to fix any type warnings
interface EChartsParam {
  data: {
    name: string;
    value: number;
    path: string;
    children?: SunburstData[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export default function DirectoryVisualizer({ path }: { path: string }) {
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

  useEffect(() => {
    const fetchData = async () => {
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

        const result = await scanDirectory(currentPath, depth, scanOptions);
        setData(result);
        setScanEndTime(Date.now());
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
    };

    if (currentPath) {
      fetchData();
    }
  }, [currentPath, depth, scanMode, skipHidden]);

  const getScanDuration = () => {
    if (scanStartTime && scanEndTime) {
      const durationMs = scanEndTime - scanStartTime;
      return (durationMs / 1000).toFixed(2);
    }
    return null;
  };

  const transformToSunburst = (item: DiskItem): SunburstData => {
    const result: SunburstData = {
      name: item.name,
      value: item.size,
      path: item.path,
      itemStyle: {
        color: item.is_dir ? "#3b82f6" : "#60a5fa",
      },
    };

    if (item.children && item.children.length > 0) {
      result.children = item.children.map((child) =>
        transformToSunburst(child)
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
            type: "sunburst",
            data: [transformToSunburst(data)],
            radius: ["0%", "95%"],
            label: {
              show: true,
              formatter: (params: EChartsParam) => {
                return params.data.name;
              },
            },
            itemStyle: {
              borderWidth: 1,
              borderColor: "rgba(255, 255, 255, 0.5)",
            },
            levels: [
              {},
              {
                r0: "0%",
                r: "40%",
                label: {
                  rotate: "radial",
                },
              },
              {
                r0: "40%",
                r: "70%",
                label: {
                  align: "right",
                },
              },
              {
                r0: "70%",
                r: "72%",
                label: {
                  position: "outside",
                  padding: 3,
                  silent: false,
                },
                itemStyle: {
                  borderWidth: 3,
                },
              },
            ],
          },
        ],
      }
    : {};

  const handleClick = (params: EChartsParam) => {
    if (params?.data?.path && params?.data?.children) {
      setCurrentPath(params.data.path);
    }
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
      <div className="mb-4 flex flex-col md:flex-row gap-4 items-start md:items-center flex-wrap">
        <div className="mr-4">
          <h2 className="text-xl font-bold">Directory Analysis</h2>
          <p className="text-sm text-gray-600">{currentPath}</p>
          {getScanDuration() && (
            <p className="text-xs text-gray-500">
              Scan completed in {getScanDuration()} seconds
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4 ml-auto">
          <div>
            <label htmlFor="depth" className="block text-sm mb-1">
              Scan Depth:
            </label>
            <select
              id="depth"
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
            <label htmlFor="scan-mode" className="block text-sm mb-1">
              Scan Mode:
            </label>
            <select
              id="scan-mode"
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

          <div className="h-[600px] w-full">
            <ReactECharts
              option={option}
              style={{ height: "100%", width: "100%" }}
              onEvents={{
                click: handleClick,
              }}
            />
          </div>
        </>
      )}

      <ScanProgress isScanning={isScanning} />
    </div>
  );
}
