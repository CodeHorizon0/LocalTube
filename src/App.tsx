// App.tsx
import React, { Suspense, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import styles from "./App.module.css";
import { VideoFile, StartupStatus, VIDEO_FORMATS } from "./types";

const VideoCard = React.lazy(function () {
  return import("./components/VideoCard");
});

function App() {
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function scan(folder: string) {
    setLoading(true);
    try {
      const result = await invoke<VideoFile[]>("scan_videos", {
        basePath: folder,
        extensions: VIDEO_FORMATS,
      });
      setVideos(result);
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
          setError(status.error);
        }
        if (status.library_path) {
          setPath(status.library_path);
          await scan(status.library_path);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  if (error) {
    return (
      <div className={styles.emptyState}>
        <h1>LocalTube</h1>
        <p>{error}</p>
        <button className={styles.primaryBtn} onClick={chooseFolder}>
          Choose video folder
        </button>
      </div>
    );
  }

  if (!path) {
    return (
      <div className={styles.emptyState}>
        <h1>LocalTube</h1>
        <p>Select a folder with your video files</p>
        <button className={styles.primaryBtn} onClick={chooseFolder}>
          Choose folder
        </button>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.appHeader}>
        <h1>LocalTube</h1>
        <div className={styles.headerActions}>
          <span className={styles.folderPath}>{path}</span>
          <button className={styles.secondaryBtn} onClick={chooseFolder}>
            Change folder
          </button>
        </div>
      </header>

      <div className={styles.videoGridContainer}>
        {loading ? (
          <div className={styles.videoGrid}>
            {Array.from({ length: 8 }).map(function (_, i) {
              return <VideoCard key={i} skeleton={true} />;
            })}
          </div>
        ) : videos.length === 0 ? (
          <div className={styles.noVideos}>No videos in this folder</div>
        ) : (
          <div className={styles.videoGrid}>
            <Suspense fallback={<div>Loading...</div>}>
              {videos.map(function (video) {
                return <VideoCard key={video.path} video={video} />;
              })}
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;