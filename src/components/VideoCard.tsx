// VideoCard.tsx
import React, { useEffect, useState, useRef } from "react";
import styles from "./VideoCard.module.css";
import { VideoFile } from "../types";
import { generateThumbnail, computeShadowColor, shadowColorCache } from "../utils/thumbnailHelpers";

interface VideoCardProps {
  video?: VideoFile;
  skeleton?: boolean;
}

function VideoCard({ video, skeleton = false }: VideoCardProps) {
  if (skeleton) {
    return (
      <div className={styles.videoCard}>
        <div className={styles.thumbnailSkeleton} />
        <div className={styles.videoInfo}>
          <h3 className={styles.titleSkeleton} />
        </div>
      </div>
    );
  }

  const displayName = video!.name.replace(/\.[^.]+$/, "");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [shadowColor, setShadowColor] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const isColorGenerated = useRef<boolean>(false);

  useEffect(function () {
    let mounted = true;

    function loadThumbnail() {
      generateThumbnail(video!.path)
        .then(function (url) {
          if (mounted) {
            setThumbnailUrl(url);
            setLoading(false);
          }
        })
        .catch(function (err) {
          console.error("Failed to generate thumbnail for", video!.path, err);
          if (mounted) {
            setLoading(false);
          }
        });
    }

    loadThumbnail();

    return function () {
      mounted = false;
    };
  }, [video!.path]);

  function handleMouseEnter() {
    if (isColorGenerated.current) return;
    if (!thumbnailUrl) return;

    const cached = shadowColorCache.get(video!.path);
    if (cached) {
      setShadowColor(cached);
      isColorGenerated.current = true;
      return;
    }

    const img = imgRef.current;
    if (!img) return;

    function computeColor(element: HTMLImageElement) {
      const color = computeShadowColor(element);
      if (color) {
        shadowColorCache.set(video!.path, color);
        setShadowColor(color);
      }
      isColorGenerated.current = true;
    }

    if (img.complete) {
      computeColor(img);
    } else {
      img.onload = function () {
        computeColor(img);
      };
    }
  }

  const cardStyle = shadowColor
    ? ({ "--shadow-color": shadowColor } as React.CSSProperties)
    : {};

  return (
    <div
      className={styles.videoCard}
      style={cardStyle}
      onMouseEnter={handleMouseEnter}
    >
      <div className={styles.thumbnail}>
        {loading ? (
          <div className={styles.thumbnailSkeleton} />
        ) : thumbnailUrl ? (
          <img
            ref={imgRef}
            src={thumbnailUrl}
            alt={displayName}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className={styles.thumbnailPlaceholder}>No preview</div>
        )}
      </div>
      <div className={styles.videoInfo}>
        <h3 className={styles.videoTitle}>{displayName}</h3>
      </div>
    </div>
  );
}

export default VideoCard;