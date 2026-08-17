// VideoPlayer.tsx
import { useRef, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import styles from "./VideoPlayer.module.css";
import { VideoFile } from "../types";
import { getDominantColorFromImageData } from "../utils/thumbnailHelpers";

interface VideoPlayerProps {
  video: VideoFile;
}

function VideoPlayer({ video }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoSrc: string = convertFileSrc(video.path);
  const [bgColor, setBgColor] = useState<string>("transparent");
  const frameCountRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationIdRef = useRef<number | null>(null);

  useEffect(
    function (): (() => void) | void {
      const videoElement: HTMLVideoElement | null = videoRef.current;
      if (!videoElement) {
        return;
      }

      function handleFrame(_now: number, _metadata: unknown): void {
        const currentVideo: HTMLVideoElement | null = videoRef.current;
        if (!currentVideo) {
          return;
        }
        frameCountRef.current = frameCountRef.current + 1;
        if (frameCountRef.current % 5 === 0) {
          if (!canvasRef.current) {
            canvasRef.current = document.createElement("canvas");
          }
          const canvas: HTMLCanvasElement = canvasRef.current;
          const ctx: CanvasRenderingContext2D | null = canvas.getContext("2d", {
            willReadFrequently: true,
          });
          if (!ctx) {
            return;
          }
          const width: number = currentVideo.videoWidth || 320;
          const height: number = currentVideo.videoHeight || 180;
          canvas.width = width;
          canvas.height = height;
          try {
            ctx.drawImage(currentVideo, 0, 0, width, height);
            const imageData: ImageData = ctx.getImageData(0, 0, width, height);
            const color: string | null = getDominantColorFromImageData(imageData);
            if (color) {
              setBgColor(color);
            }
          } catch (_error) {
          }
        }
        if (currentVideo.paused || currentVideo.ended) {
          return;
        }
        animationIdRef.current = currentVideo.requestVideoFrameCallback(handleFrame);
      }

      function startFrameCallback(): (() => void) | undefined {
        const currentVideo: HTMLVideoElement | null = videoRef.current;
        if (!currentVideo) {
          return;
        }
        if ("requestVideoFrameCallback" in currentVideo) {
          animationIdRef.current = currentVideo.requestVideoFrameCallback(handleFrame);
        } else {
          const interval: number = window.setInterval(function (): void {
            const vid: HTMLVideoElement | null = videoRef.current;
            if (!vid || vid.paused || vid.ended) {
              return;
            }
            frameCountRef.current = frameCountRef.current + 1;
            if (frameCountRef.current % 5 === 0) {
              if (!canvasRef.current) {
                canvasRef.current = document.createElement("canvas");
              }
              const canvas: HTMLCanvasElement = canvasRef.current;
              const ctx: CanvasRenderingContext2D | null = canvas.getContext("2d", {
                willReadFrequently: true,
              });
              if (!ctx) {
                return;
              }
              const width: number = vid.videoWidth || 320;
              const height: number = vid.videoHeight || 180;
              canvas.width = width;
              canvas.height = height;
              try {
                ctx.drawImage(vid, 0, 0, width, height);
                const imageData: ImageData = ctx.getImageData(0, 0, width, height);
                const color: string | null = getDominantColorFromImageData(imageData);
                if (color) {
                  setBgColor(color);
                }
              } catch (_error) {
                // Canvas tainted, skip
              }
            }
          }, 200);
          return function (): void {
            window.clearInterval(interval);
          };
        }
        return;
      }

      const cleanup: (() => void) | undefined = startFrameCallback();

      function onPlay(): void {
        const currentVideo: HTMLVideoElement | null = videoRef.current;
        if (!currentVideo) {
          return;
        }
        frameCountRef.current = 0;
        if ("requestVideoFrameCallback" in currentVideo) {
          if (animationIdRef.current !== null) {
            currentVideo.cancelVideoFrameCallback(animationIdRef.current);
          }
          animationIdRef.current = currentVideo.requestVideoFrameCallback(handleFrame);
        }
      }

      videoElement.addEventListener("play", onPlay);

      return function (): void {
        const currentVideo: HTMLVideoElement | null = videoRef.current;
        if (currentVideo && "cancelVideoFrameCallback" in currentVideo && animationIdRef.current !== null) {
          currentVideo.cancelVideoFrameCallback(animationIdRef.current);
        }
        if (typeof cleanup === "function") {
          cleanup();
        }
        if (currentVideo) {
          currentVideo.removeEventListener("play", onPlay);
        }
      };
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
        crossOrigin="anonymous"
        style={{ backgroundColor: bgColor }}
      />
    </div>
  );
}

export default VideoPlayer;