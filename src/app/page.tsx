"use client";

import { useState } from "react";
import DriveList from "@/components/drive-list";
import DirectoryVisualizer from "@/components/directory-visualizer";
import TreemapVisualizer from "@/components/treemap-visualizer";

export default function Home() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [visualizationType, setVisualizationType] = useState<
    "sunburst" | "treemap"
  >("sunburst");

  const handleSelectDrive = (drivePath: string) => {
    setSelectedPath(drivePath);
  };

  const handleVisualizationChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    setVisualizationType(e.target.value as "sunburst" | "treemap");
  };

  return (
    <main className="flex min-h-screen flex-col p-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">DiskSense</h1>
        <p className="text-gray-600">Analyze and visualize your disk usage</p>
      </div>

      {!selectedPath ? (
        <DriveList onSelectDrive={handleSelectDrive} />
      ) : (
        <div>
          <div className="mb-4 flex justify-between items-center">
            <button
              onClick={() => setSelectedPath(null)}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 transition"
            >
              ← Back to Drives
            </button>
            <div>
              <label htmlFor="visualization-type" className="mr-2">
                Visualization Type:
              </label>
              <select
                id="visualization-type"
                value={visualizationType}
                onChange={handleVisualizationChange}
                className="border rounded p-2"
              >
                <option value="sunburst">Sunburst Chart</option>
                <option value="treemap">Treemap</option>
              </select>
            </div>
          </div>

          {visualizationType === "sunburst" ? (
            <DirectoryVisualizer path={selectedPath} />
          ) : (
            <TreemapVisualizer path={selectedPath} />
          )}
        </div>
      )}
    </main>
  );
}
