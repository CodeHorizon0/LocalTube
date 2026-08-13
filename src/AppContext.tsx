import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { VideoFile, StartupStatus, VIDEO_FORMATS } from "./types";

interface AppContextType {
  videos: VideoFile[];
  setVideos: (videos: VideoFile[]) => void;
  path: string | null;
  setPath: (path: string | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  scan: (folder: string) => Promise<void>;
  chooseFolder: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function scan(folder: string) {
    setLoading(true);
    try {
      const result = await invoke<VideoFile[]>("scan_videos", {
        basePath: folder,
        extensions: VIDEO_FORMATS,
      });
      setVideos(result);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function chooseFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (typeof selected !== "string") return;
    await invoke("set_library_path", { path: selected });
    setPath(selected);
    await scan(selected);
  }

  useEffect(function () {
    async function init() {
      try {
        const status = await invoke<StartupStatus>("get_startup_status");
        if (!status.ffmpeg_available) {
          setError(status.error || "FFmpeg not available");
        }
        if (status.library_path) {
          setPath(status.library_path);
          await scan(status.library_path);
        }
      } catch (e) {
        setError(String(e));
      }
    }
    init();
  }, []);

  const value: AppContextType = {
    videos,
    setVideos,
    path,
    setPath,
    loading,
    setLoading,
    error,
    setError,
    scan,
    chooseFolder,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
}