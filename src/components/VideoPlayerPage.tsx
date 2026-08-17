// VideoPlayerPage.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppContext } from "../AppContext";
import VideoPlayer from "./VideoPlayer";
import VideoList from "./VideoList";
import styles from "./VideoPlayerPage.module.css";

function cleanTitle(filename: string): string {
  let name = filename.replace(/\.[^.]+$/, "");
  name = name.replace(/[^a-zA-Z0-9]/g, " ");
  name = name.replace(/\s+/g, " ").trim();
  return name;
}

function VideoPlayerPage() {
  const { encodedPath } = useParams<{ encodedPath: string }>();
  const navigate = useNavigate();
  const { videos, loading } = useAppContext();
  const [currentVideo, setCurrentVideo] = useState<any>(null);

  useEffect(
    function () {
      if (encodedPath) {
        const path = decodeURIComponent(encodedPath);
        const found = videos.find(function (v) { return v.path === path; });
        setCurrentVideo(found || null);
      } else {
        setCurrentVideo(null);
      }
    },
    [encodedPath, videos]
  );

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (!currentVideo) {
    return (
      <div className={styles.notFound}>
        <h2>Video not found</h2>
        <button className={styles.backButton} onClick={function () { navigate("/"); }}>
          Go back to library
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.playerWrapper}>
        <VideoPlayer video={currentVideo} />
        <div className={styles.videoTitle}>{cleanTitle(currentVideo.name)}</div>
      </div>
      <div className={styles.sidebar}>
        <VideoList
          videos={videos}
          currentVideoPath={currentVideo.path}
        />
      </div>
    </div>
  );
}

export default VideoPlayerPage;