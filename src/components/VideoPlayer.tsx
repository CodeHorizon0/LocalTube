import { useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import styles from "./VideoPlayer.module.css";
import { VideoFile } from "../types";

interface VideoPlayerProps {
  video: VideoFile;
}

function VideoPlayer({ video }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoSrc = convertFileSrc(video.path);

  useEffect(
    function () {
      if (videoRef.current) {
        videoRef.current.load();
        videoRef.current.play().catch(function (err) {
          console.log("Autoplay blocked", err);
        });
      }
    },
    [video]
  );

  return (
    <div className={styles.playerContainer}>
      <video
        ref={videoRef}
        className={styles.videoElement}
        src={videoSrc}
        controls
        autoPlay
        playsInline
      />
    </div>
  );
}

export default VideoPlayer;