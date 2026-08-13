import React, { Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider, useAppContext } from "./AppContext";
import styles from "./App.module.css";
import VideoCard from "./components/VideoCard";
import VideoPlayerPage from "./components/VideoPlayerPage";

function HomePage() {
  const { videos, path, loading, error, chooseFolder } = useAppContext();

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

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/video/:encodedPath" element={<VideoPlayerPage />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;