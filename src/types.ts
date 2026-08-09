export interface VideoFile {
  path: string;
  name: string;
}

export interface StartupStatus {
  library_path: string | null;
  ffmpeg_available: boolean;
  error: string | null;
}

export interface ColorGroup {
  count: number;
  sumR: number;
  sumG: number;
  sumB: number;
}


export const VIDEO_FORMATS = ["mp4", "mov", "mkv", "avi", "webm", "m4v", "flv", "3gp"];