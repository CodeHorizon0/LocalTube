import styles from "./VideoList.module.css";
import VideoCard from "./VideoCard";
import { VideoFile } from "../types";

interface VideoListProps {
  videos: VideoFile[];
  currentVideoPath: string;
}

function VideoList({ videos, currentVideoPath }: VideoListProps) {
  const otherVideos = videos.filter(function (v) {
    return v.path !== currentVideoPath;
  });

  if (otherVideos.length === 0) {
    return <div className={styles.empty}>No other videos</div>;
  }

  return (
    <div className={styles.list}>
      {otherVideos.map(function (video) {
        return <VideoCard key={video.path} video={video} />;
      })}
    </div>
  );
}

export default VideoList;