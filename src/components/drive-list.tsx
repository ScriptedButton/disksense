"use client";

import { useEffect, useState } from "react";
import { getDriveInfo, formatBytes, DriveInfo } from "@/lib/disk-utils";

export default function DriveList({
  onSelectDrive,
}: {
  onSelectDrive: (drivePath: string) => void;
}) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDrives = async () => {
      try {
        setLoading(true);
        const drivesInfo = await getDriveInfo();
        setDrives(drivesInfo);
        setError(null);
      } catch (err) {
        setError("Failed to load drives information");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchDrives();
  }, []);

  if (loading) {
    return <div className="p-4">Loading drives information...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-500">{error}</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Available Drives</h2>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {drives.map((drive) => (
          <div
            key={drive.mount_point}
            className="border rounded-lg p-4 hover:bg-gray-100 cursor-pointer transition"
            onClick={() => onSelectDrive(drive.mount_point)}
          >
            <h3 className="font-semibold text-lg">{drive.name}</h3>
            <p className="text-sm text-gray-600">{drive.mount_point}</p>
            <div className="mt-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full"
                  style={{
                    width: `${(drive.used_space / drive.total_space) * 100}%`,
                  }}
                ></div>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span>{formatBytes(drive.used_space)} used</span>
                <span>{formatBytes(drive.available_space)} free</span>
              </div>
              <div className="text-sm text-right">
                {formatBytes(drive.total_space)} total
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
