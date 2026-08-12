import React, { useEffect, useState, useRef } from "react";
import styles from "./VideoCard.module.css";
import { VideoFile } from "../types";
import {
  generateThumbnail,
  generatePreviewGif,
  computeShadowColor,
  shadowColorCache,
} from "../utils/thumbnailHelpers";

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

  const [previewGifUrl, setPreviewGifUrl] = useState<string | null>(null);
  const [showGif, setShowGif] = useState<boolean>(false);
  const [gifLoading, setGifLoading] = useState<boolean>(false);
  const hoverTimerRef = useRef<number | null>(null);
  const isHoveringRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  useEffect(
    function () {
      isMountedRef.current = true;

      function loadThumbnail() {
        generateThumbnail(video!.path)
          .then(function (url) {
            if (isMountedRef.current) {
              setThumbnailUrl(url);
              setLoading(false);
            }
          })
          .catch(function (err) {
            console.error("Failed to generate thumbnail for", video!.path, err);
            if (isMountedRef.current) {
              setLoading(false);
            }
          });
      }

      loadThumbnail();

      return function () {
        isMountedRef.current = false;
        if (hoverTimerRef.current !== null) {
          window.clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
      };
    },
    [video!.path]
  );

  function handleMouseEnter() {
    isHoveringRef.current = true;

    if (isColorGenerated.current === false) {
      if (!thumbnailUrl) return;

      const cached = shadowColorCache.get(video!.path);
      if (cached) {
        setShadowColor(cached);
        isColorGenerated.current = true;
      } else {
        const img = imgRef.current;
        if (img) {
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
      }
    }

    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    hoverTimerRef.current = window.setTimeout(function () {
      if (previewGifUrl) {
        setShowGif(true);
        return;
      }
      if (!gifLoading) {
        setGifLoading(true);
        generatePreviewGif(video!.path)
          .then(function (url) {
            if (isMountedRef.current && isHoveringRef.current) {
              setPreviewGifUrl(url);
              setShowGif(true);
            }
            setGifLoading(false);
          })
          .catch(function (err) {
            console.error("Failed to generate preview gif for", video!.path, err);
            if (isMountedRef.current) {
              setGifLoading(false);
            }
          });
      }
    }, 500);
  }

  function handleMouseLeave() {
    isHoveringRef.current = false;
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setShowGif(false);
    setGifLoading(false);
  }

  const cardStyle = shadowColor
    ? ({ "--shadow-color": shadowColor } as React.CSSProperties)
    : {};

  let thumbnailContent = null;
  if (loading) {
    thumbnailContent = <div className={styles.thumbnailSkeleton} />;
  } else if (showGif && previewGifUrl) {
    thumbnailContent = (
      <img src={previewGifUrl} alt={displayName} loading="lazy" decoding="async" />
    );
  } else if (thumbnailUrl) {
    thumbnailContent = (
      <img
        ref={imgRef}
        src={thumbnailUrl}
        alt={displayName}
        loading="lazy"
        decoding="async"
      />
    );
  } else {
    thumbnailContent = <div className={styles.thumbnailPlaceholder}>No preview</div>;
  }

  return (
    <div
      className={styles.videoCard}
      style={cardStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={styles.thumbnail}>{thumbnailContent}</div>
      <div className={styles.videoInfo}>
        <h3 className={styles.videoTitle}>{displayName}</h3>
      </div>
    </div>
  );
}

export default VideoCard;