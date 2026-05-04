/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
  Upload,
  Scissors,
  Download,
  Trash2,
  Play,
  Pause,
  Clock,
  Video,
  ChevronRight,
  ChevronLeft,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  Music,
  Plus,
  Film,
  ZoomIn,
  ZoomOut,
  Settings,
  Eye,
  EyeOff,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  GripVertical,
  GripHorizontal,
  Maximize2,
  Minimize2,
  Maximize,
  Layers,
  FileVideo,
  FileAudio,
  FileImage,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, formatTime } from "@/src/lib/utils";
import { saveVideo, getAllVideos, deleteVideo } from "@/src/lib/storage";

type AssetType = "video" | "image" | "audio" | "gif";

interface CutRange {
  id: string;
  start: number;
  end: number;
}

interface VideoSegment {
  id: string;
  file: File;
  type: AssetType;
  url: string;
  duration: number;
  ranges: CutRange[];
  thumbnails: string[];
}

interface TrimmedVideo {
  id: string;
  name: string;
  blob: Blob;
  duration: number;
  size: number;
  createdAt: number;
}

export default function App() {
  // State
  const [ffmpeg, setFfmpeg] = useState<FFmpeg | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Layout State
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<"sessions" | "vault" | "settings">("sessions");
  const [showPreview, setShowPreview] = useState(true);
  const [previewHeight, setPreviewHeight] = useState(480);

  // Resizing Refs
  const isResizingSidebar = useRef(false);
  const isResizingPreview = useRef(false);

  // Format & Quality State
  const [outputFormat, setOutputFormat] = useState<string>("mp4");
  const [compressionMode, setCompressionMode] = useState<"none" | "medium" | "high">("none");
  const [conversionTarget, setConversionTarget] = useState<"video" | "audio" | "gif">("video");

  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [isSourcePlaying, setIsSourcePlaying] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [sourceVolume, setSourceVolume] = useState(1);
  const [previewVolume, setPreviewVolume] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [showAllMarkers, setShowAllMarkers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [exportQuality, setExportQuality] = useState<{
    label: string;
    crf: string;
    scale: string;
  }>({ label: "1080p", crf: "18", scale: "1920:1080" });

  const [shortcuts, setShortcuts] = useState({
    play: " ",
    zoomIn: "+",
    zoomOut: "-",
    forward: "ArrowRight",
    backward: "ArrowLeft",
    addMarker: "Enter",
  });

  const [gallery, setGallery] = useState<TrimmedVideo[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  const activeSegment = segments[activeSegmentIndex];

  // ... (loadFFmpeg and loadGallery remain similar but updated below)

  const generateThumbnails = async (
    file: File,
    duration: number,
  ): Promise<string[]> => {
    if (!ffmpeg || file.type.startsWith("audio/")) return [];

    try {
      const inputName = "thumb_input.mp4";
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      const count = 5;
      const interval = duration / (count + 1);
      
      // Single-pass thumbnail generation (Much faster)
      await ffmpeg.exec([
        "-i", inputName,
        "-vf", `fps=1/${interval},scale=160:-1`,
        "-frames:v", count.toString(),
        "thumb_%d.jpg"
      ]);

      const thumbnails: string[] = [];
      for (let i = 1; i <= count; i++) {
        try {
          const fileName = `thumb_${i}.jpg`;
          const data = await ffmpeg.readFile(fileName);
          const url = URL.createObjectURL(
            new Blob([data as Uint8Array], { type: "image/jpeg" }),
          );
          thumbnails.push(url);
          await ffmpeg.deleteFile(fileName);
        } catch (e) {}
      }
      
      await ffmpeg.deleteFile(inputName);
      return thumbnails;
    } catch (e) {
      console.error("Thumbnail generation failed:", e);
      return [];
    }
  };

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: AssetType = "video",
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Non-blocking upload: add segments immediately
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      
      const newSegment: VideoSegment = {
        id: crypto.randomUUID(),
        file,
        type,
        url,
        duration: 0,
        ranges: [],
        thumbnails: [],
      };

      setSegments(prev => [...prev, newSegment]);

      // Background metadata & thumb processing
      (async () => {
        let duration = 0;
        let thumbnails: string[] = [];

        try {
          if (type === "video" || type === "gif") {
            const tempVideo = document.createElement("video");
            tempVideo.src = url;
            await new Promise((r) => (tempVideo.onloadedmetadata = r));
            duration = tempVideo.duration;
            thumbnails = await generateThumbnails(file, duration);
          } else if (type === "audio") {
            const tempAudio = new Audio(url);
            await new Promise((r) => (tempAudio.onloadedmetadata = r));
            duration = tempAudio.duration;
          } else if (type === "image") {
            duration = 5;
          }

          setSegments(prev => prev.map(s => s.id === newSegment.id ? {
            ...s,
            duration,
            ranges: [{ id: crypto.randomUUID(), start: 0, end: duration }],
            thumbnails
          } : s));
        } catch (err) {
          console.error("Background processing error:", err);
        }
      })();
    }
  };

  // Initialize FFmpeg
  useEffect(() => {
    loadFFmpeg();
    loadGallery();
  }, []);

  const loadFFmpeg = async () => {
    // Usando JSDelivr para maior estabilidade em ambientes sandbox
    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
    const ffmpeg = new FFmpeg();

    ffmpeg.on("log", ({ message }) => {
      console.log("FFmpeg Engine:", message);
    });

    ffmpeg.on("progress", ({ progress }) => {
      setProgress(progress * 100);
    });

    try {
      console.log("Iniciando Engine de Vídeo...");
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript",
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
      });
      console.log("Engine Pronto");
      setFfmpeg(ffmpeg);
      ffmpegRef.current = ffmpeg;
      setIsLoaded(true);
    } catch (error) {
      console.error(
        "Falha no Engine Principal (MT), tentando modo compatibilidade...",
        error,
      );
      try {
        // Tenta carregar sem Worker (caso o navegador bloqueie workers cross-origin)
        await ffmpeg.load({
          coreURL: await toBlobURL(
            `${baseURL}/ffmpeg-core.js`,
            "text/javascript",
          ),
          wasmURL: await toBlobURL(
            `${baseURL}/ffmpeg-core.wasm`,
            "application/wasm",
          ),
        });
        console.log("Engine Carregado em Modo de Compatibilidade");
        setFfmpeg(ffmpeg);
        ffmpegRef.current = ffmpeg;
        setIsLoaded(true);
      } catch (innerError) {
        console.error("Falha Crítica no Engine:", innerError);
        alert(
          "Erro ao carregar o motor de processamento. Por favor, tente atualizar a página ou usar o Chrome/Edge.",
        );
      }
    }
  };

  // Resizing logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar.current) {
        const newWidth = window.innerWidth - e.clientX;
        setSidebarWidth(Math.min(Math.max(newWidth, 200), 800));
      }
      if (isResizingPreview.current) {
        const newHeight = e.clientY - 80; // Adjust for header height
        setPreviewHeight(Math.min(Math.max(newHeight, 200), 800));
      }
    };

    const handleMouseUp = () => {
      isResizingSidebar.current = false;
      isResizingPreview.current = false;
      document.body.style.cursor = "default";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const loadGallery = async () => {
    try {
      const videos = await getAllVideos();
      setGallery([...videos]); // Garantir nova referência para disparar renderização do React
    } catch (err) {
      console.error("Falha ao carregar galeria:", err);
    }
  };

  // Handlers
  const handleTrim = async () => {
    if (!ffmpeg || segments.length === 0) return;

    setIsProcessing(true);
    setProgress(0);

    const crf = compressionMode === "high" ? "32" : compressionMode === "medium" ? "26" : exportQuality.crf;
    const isAudioOnly = conversionTarget === "audio";
    const isGif = conversionTarget === "gif";
    const extension = isAudioOnly ? "mp3" : isGif ? "gif" : outputFormat;
    const finalMime = isAudioOnly ? "audio/mpeg" : isGif ? "image/gif" : `video/${outputFormat}`;

    try {
      const inputFiles: string[] = [];
      const concatList: string[] = [];
      let sliceIndex = 0;

      for (const seg of segments) {
        const inputName = `input_${seg.id.slice(0, 8)}_${seg.type === "audio" ? "mp3" : seg.type === "image" ? "jpg" : "mp4"}`;
        await ffmpeg.writeFile(inputName, await fetchFile(seg.file));
        inputFiles.push(inputName);

        for (const range of seg.ranges) {
          const trimmedName = `slice_${sliceIndex}.${extension}`;

          try { await ffmpeg.deleteFile(trimmedName); } catch (e) {}

          if (isAudioOnly) {
            await ffmpeg.exec([
              "-ss", range.start.toString(),
              "-to", range.end.toString(),
              "-i", inputName,
              "-vn",
              "-acodec", "libmp3lame",
              "-ab", "192k",
              trimmedName
            ]);
          } else if (isGif) {
            await ffmpeg.exec([
              "-ss", range.start.toString(),
              "-to", range.end.toString(),
              "-i", inputName,
              "-vf", "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
              trimmedName
            ]);
          } else if (seg.type === "video" || seg.type === "gif") {
            await ffmpeg.exec([
              "-ss", range.start.toString(),
              "-to", range.end.toString(),
              "-i", inputName,
              "-vf", `scale=${exportQuality.scale}:force_original_aspect_ratio=decrease,pad=${exportQuality.scale}:(ow-iw)/2:(oh-ih)/2`,
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-crf", crf,
              "-c:a", "aac",
              trimmedName,
            ]);
          } else if (seg.type === "image") {
            await ffmpeg.exec([
              "-loop", "1",
              "-i", inputName,
              "-t", (range.end - range.start).toString(),
              "-vf", `scale=${exportQuality.scale}:force_original_aspect_ratio=decrease,pad=${exportQuality.scale}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-crf", crf,
              trimmedName,
            ]);
          } else if (seg.type === "audio") {
            await ffmpeg.exec([
              "-f", "lavfi",
              "-i", `color=c=black:s=${exportQuality.scale.replace(":", "x")}:r=25`,
              "-ss", range.start.toString(),
              "-to", range.end.toString(),
              "-i", inputName,
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-crf", crf,
              "-c:a", "aac",
              "-shortest",
              trimmedName,
            ]);
          }

          concatList.push(`file ${trimmedName}`);
          inputFiles.push(trimmedName);
          sliceIndex++;
        }
      }

      let finalBlob: Blob;
      const concatFileName = "concat.txt";
      await ffmpeg.writeFile(concatFileName, concatList.join("\n"));
      inputFiles.push(concatFileName);

      const outputName = `final_output.${extension}`;
      try { await ffmpeg.deleteFile(outputName); } catch (e) {}
      
      if (extension === "mp4" || extension === "mp3") {
        await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", concatFileName, "-c", "copy", outputName]);
      } else {
        await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", concatFileName, outputName]);
      }

      const data = await ffmpeg.readFile(outputName);
      finalBlob = new Blob([data as Uint8Array], { type: finalMime });
      inputFiles.push(outputName);

      const totalDuration = segments.reduce((acc, seg) => 
        acc + seg.ranges.reduce((rAcc, r) => rAcc + (r.end - r.start), 0), 0
      );

      const newVideo = {
        id: crypto.randomUUID(),
        name: `Sequence_Export_${Date.now()}.${extension}`,
        blob: finalBlob,
        duration: totalDuration,
        size: finalBlob.size,
        createdAt: Date.now()
      };

      await saveVideo(newVideo);
      await loadGallery();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);

      for (const f of inputFiles) {
        try {
          await ffmpeg.deleteFile(f);
        } catch (e) {}
      }
    } catch (error) {
      console.error("Session export failure:", error);
      alert("Error during export. Check console for details.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteVideo(id);
    await loadGallery();
  };

  const downloadVideo = (video: TrimmedVideo) => {
    const url = URL.createObjectURL(video.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = video.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handlers
  const handleDeleteSegment = (id: string) => {
    const newSegments = segments.filter((s) => s.id !== id);
    setSegments(newSegments);
    if (activeSegmentIndex >= newSegments.length) {
      setActiveSegmentIndex(Math.max(0, newSegments.length - 1));
    }
  };

  // Sync previews
  const [activeRangeIndex, setActiveRangeIndex] = useState(0);

  useEffect(() => {
    setActiveRangeIndex(0);
  }, [activeSegmentIndex]);

  const activeRange = activeSegment?.ranges[activeRangeIndex];

  // Storage estimation logic
  const originalSizeBytes = segments.reduce((acc, s) => acc + s.file.size, 0);
  const savedPercentage = compressionMode === "high" || conversionTarget === "audio"
    ? 85
    : compressionMode === "medium"
      ? 50
      : exportQuality.label === "1080p"
        ? 10
        : 5;
  
  const totalTrimDuration = segments.reduce((acc, seg) => 
    acc + seg.ranges.reduce((rAcc, r) => rAcc + (r.end - r.start), 0), 0
  );
  const totalOriginalDuration = segments.reduce((acc, s) => acc + s.duration, 0);
  const trimRatio = totalOriginalDuration > 0 ? totalTrimDuration / totalOriginalDuration : 1;
  const estimatedSizeBytes = originalSizeBytes * trimRatio * (1 - savedPercentage / 100);
  const totalSavedPercentage = originalSizeBytes > 0 
    ? Math.max(0, Math.round((1 - estimatedSizeBytes / originalSizeBytes) * 100))
    : 0;

  useEffect(() => {
    if (activeRange && previewRef.current) {
      previewRef.current.currentTime = activeRange.start;
      setPreviewTime(activeRange.start);
    }
  }, [activeRangeIndex, activeRange?.start]);

  const toggleSourcePlay = () => {
    if (videoRef.current) {
      if (isSourcePlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsSourcePlaying(!isSourcePlaying);
    }
  };

  const togglePreviewPlay = () => {
    if (previewRef.current) {
      if (isPreviewPlaying) previewRef.current.pause();
      else previewRef.current.play();
      setIsPreviewPlaying(!isPreviewPlaying);
    }
  };

  const toggleFullscreen = (ref: React.RefObject<HTMLVideoElement | null>) => {
    if (ref.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        ref.current.requestFullscreen();
      }
    }
  };

  const handleSourceSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setSourceTime(time);
    }
  };

  const handlePreviewSeek = (time: number) => {
    if (previewRef.current && activeRange) {
      const clampedTime = Math.max(activeRange.start, Math.min(time, activeRange.end));
      previewRef.current.currentTime = clampedTime;
      setPreviewTime(clampedTime);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT") return;

      if (e.key === shortcuts.play) {
        e.preventDefault();
        toggleSourcePlay();
      } else if (e.key === shortcuts.zoomIn) {
        setZoom((z) => Math.min(z + 0.5, 10));
      } else if (e.key === shortcuts.zoomOut) {
        setZoom((z) => Math.max(z - 0.5, 1));
      } else if (e.key === shortcuts.forward) {
        handleSourceSeek(sourceTime + 0.1);
      } else if (e.key === shortcuts.backward) {
        handleSourceSeek(sourceTime - 0.1);
      } else if (e.key === shortcuts.addMarker) {
        e.preventDefault();
        addMarker();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, isSourcePlaying, activeSegmentIndex, sourceTime]);

  const handleSourceTimeUpdate = () => {
    if (videoRef.current) {
      setSourceTime(videoRef.current.currentTime);
    }
  };

  const handlePreviewTimeUpdate = () => {
    if (previewRef.current && activeRange) {
      setPreviewTime(previewRef.current.currentTime);
      if (previewRef.current.currentTime >= activeRange.end) {
        previewRef.current.currentTime = activeRange.start;
      }
    }
  };

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = sourceVolume;
    if (previewRef.current) previewRef.current.volume = previewVolume;
  }, [sourceVolume, previewVolume]);

  const addMarker = () => {
    if (!activeSegment) return;
    const newRange: CutRange = {
      id: crypto.randomUUID(),
      start: sourceTime,
      end: Math.min(sourceTime + 5, activeSegment.duration),
    };
    const newSegments = [...segments];
    newSegments[activeSegmentIndex].ranges.push(newRange);
    setSegments(newSegments);
    setActiveRangeIndex(newSegments[activeSegmentIndex].ranges.length - 1);
  };

  const deleteMarker = (rangeId: string) => {
    if (!activeSegment || activeSegment.ranges.length <= 1) return;
    const newSegments = [...segments];
    newSegments[activeSegmentIndex].ranges = newSegments[
      activeSegmentIndex
    ].ranges.filter((r) => r.id !== rangeId);
    setSegments(newSegments);
    setActiveRangeIndex(0);
  };

  const updateRangeStart = (val: number) => {
    if (!activeRange) return;
    const newSegments = [...segments];
    newSegments[activeSegmentIndex].ranges[activeRangeIndex].start = Number(
      Math.max(0, Math.min(val, activeRange.end - 0.1)).toFixed(2),
    );
    setSegments(newSegments);
  };

  const updateRangeEnd = (val: number) => {
    if (!activeRange) return;
    const newSegments = [...segments];
    newSegments[activeSegmentIndex].ranges[activeRangeIndex].end = Number(
      Math.max(
        activeRange.start + 0.1,
        Math.min(val, activeSegment.duration),
      ).toFixed(2),
    );
    setSegments(newSegments);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 font-sans selection:bg-orange-500 selection:text-black pb-32">
      {/* Header */}
      <header className="px-8 py-6 flex items-baseline justify-between sticky top-0 bg-neutral-950/90 backdrop-blur-md z-50 border-b border-neutral-900">
        <div className="flex flex-col">
          <h1 className="text-6xl font-black tracking-tighter leading-none uppercase">
            TRIM.<span className="text-orange-500">PRO</span>
          </h1>
          <div className="flex items-center gap-2 mt-2">
            {!isLoaded ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin text-orange-500" />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] opacity-40">
                  System Warmup...
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] opacity-40">
                  Engine Online
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex bg-neutral-900 border border-neutral-800 rounded p-1 gap-1">
            <button
              onClick={() => setIsSidebarVisible(!isSidebarVisible)}
              className={cn(
                "p-2 rounded transition-colors group relative",
                isSidebarVisible
                  ? "bg-orange-500/20 text-orange-500"
                  : "hover:bg-neutral-800 text-neutral-400 hover:text-orange-500",
              )}
              title={isSidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
            >
              {isSidebarVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <div className="w-[1px] bg-neutral-800 my-1 mx-0.5" />
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={cn(
                "p-2 rounded transition-colors group relative",
                showPreview
                  ? "bg-orange-500/20 text-orange-500"
                  : "hover:bg-neutral-800 text-neutral-400 hover:text-orange-500",
              )}
              title={showPreview ? "Maximize Timeline (Hide Previews)" : "Restore Previews"}
            >
              {showPreview ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <div className="w-[1px] bg-neutral-800 my-1 mx-0.5" />
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "p-2 rounded transition-colors group relative",
                showSettings
                  ? "bg-orange-500/20 text-orange-500"
                  : "hover:bg-neutral-800 text-neutral-400 hover:text-orange-500",
              )}
              title="Shortcut Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <div className="w-[1px] bg-neutral-800 my-1 mx-0.5" />
            <label
              className="p-2 hover:bg-neutral-800 rounded cursor-pointer transition-colors group relative"
              title="Add Video"
            >
              <Film className="w-4 h-4 text-neutral-400 group-hover:text-orange-500" />
              <input
                type="file"
                multiple
                accept="video/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e, "video")}
              />
            </label>
            <label
              className="p-2 hover:bg-neutral-800 rounded cursor-pointer transition-colors group relative"
              title="Add Image"
            >
              <ImageIcon className="w-4 h-4 text-neutral-400 group-hover:text-orange-500" />
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e, "image")}
              />
            </label>
            <label
              className="p-2 hover:bg-neutral-800 rounded cursor-pointer transition-colors group relative"
              title="Add Audio"
            >
              <Music className="w-4 h-4 text-neutral-400 group-hover:text-orange-500" />
              <input
                type="file"
                multiple
                accept="audio/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e, "audio")}
              />
            </label>
            <label
              className="p-2 hover:bg-neutral-800 rounded cursor-pointer transition-colors group relative"
              title="Add GIF"
            >
              <span className="text-[10px] font-black text-neutral-400 group-hover:text-orange-500">
                GIF
              </span>
              <input
                type="file"
                multiple
                accept="image/gif"
                className="hidden"
                onChange={(e) => handleFileSelect(e, "gif")}
              />
            </label>
          </div>
          <label className="bg-white text-black px-6 py-2 text-[10px] font-black uppercase tracking-[0.2em] cursor-pointer hover:bg-orange-500 hover:text-white transition-all rounded-sm shadow-xl flex items-center gap-2">
            <Plus className="w-3 h-3" />
            Quick Add
            <input
              type="file"
              multiple
              accept="video/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden relative bg-neutral-950 mt-2">
        <div className="flex-1 flex flex-col min-w-0 h-full bg-neutral-950 overflow-hidden">
          <AnimatePresence>
            {showPreview && segments.length > 0 && (
              <div className="shrink-0 relative group/preview">
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: previewHeight }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-neutral-950/80 backdrop-blur-2xl border-b border-neutral-900 shadow-2xl z-40 px-8 py-6 overflow-hidden flex flex-col"
                >
                  <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 flex-1 min-h-0">
                    {/* Source Player */}
                    <div className="flex flex-col gap-4 min-h-0">
                      <div className="relative flex-1 bg-black rounded-2xl overflow-hidden border border-neutral-800 group/player shadow-2xl">
                        <video
                          ref={videoRef}
                          src={activeSegment?.url}
                          className="w-full h-full object-contain"
                          onTimeUpdate={handleSourceTimeUpdate}
                        />
                        <div className="absolute top-4 left-4 font-black uppercase tracking-widest text-[10px] bg-black/60 px-3 py-1 rounded border border-white/10 backdrop-blur-md">
                          Master Source
                        </div>
                        <button 
                          onClick={() => toggleFullscreen(videoRef)}
                          className="absolute bottom-4 right-4 p-2.5 bg-black/60 hover:bg-orange-500 rounded-xl transition-all text-white opacity-0 group-hover/player:opacity-100 backdrop-blur-md border border-white/10"
                        >
                          <Maximize size={16} />
                        </button>
                      </div>

                      <div className="bg-neutral-900/50 backdrop-blur-sm border border-white/5 rounded-2xl p-4 flex items-center gap-4 shrink-0">
                        <button
                          onClick={toggleSourcePlay}
                          className="w-8 h-8 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shrink-0"
                        >
                          {isSourcePlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5 fill-current" />}
                        </button>
                        <div className="flex-1">
                          <input
                            type="range"
                            min="0"
                            max={activeSegment?.duration || 0}
                            step="0.01"
                            value={sourceTime}
                            onChange={(e) => handleSourceSeek(parseFloat(e.target.value))}
                            className="w-full appearance-none bg-white/10 h-1 rounded-full cursor-pointer accent-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Preview Player */}
                    <div className="flex flex-col gap-4 min-h-0">
                      <div className="relative flex-1 bg-neutral-900 rounded-2xl overflow-hidden border border-orange-500/30 group/player shadow-2xl">
                        <video
                          ref={previewRef}
                          src={activeSegment?.url}
                          className="w-full h-full object-contain"
                          onTimeUpdate={handlePreviewTimeUpdate}
                        />
                        <div className="absolute top-4 left-4 font-black uppercase tracking-widest text-[10px] bg-orange-600 px-3 py-1 rounded text-white shadow-lg backdrop-blur-md">
                          Trim Preview
                        </div>
                        <button 
                          onClick={() => toggleFullscreen(previewRef)}
                          className="absolute bottom-4 right-4 p-2.5 bg-black/60 hover:bg-orange-500 rounded-xl transition-all text-white opacity-0 group-hover/player:opacity-100 backdrop-blur-md border border-white/10"
                        >
                          <Maximize size={16} />
                        </button>
                      </div>

                      <div className="bg-orange-500/5 backdrop-blur-sm border border-orange-500/20 rounded-2xl p-4 flex items-center gap-4 shrink-0">
                        <button
                          onClick={togglePreviewPlay}
                          className="w-8 h-8 bg-orange-500 text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shrink-0"
                        >
                          {isPreviewPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5 fill-current" />}
                        </button>
                        <div className="flex-1">
                          <input
                            type="range"
                            min={activeRange?.start || 0}
                            max={activeRange?.end || 0}
                            step="0.01"
                            value={previewTime}
                            onChange={(e) => handlePreviewSeek(parseFloat(e.target.value))}
                            className="w-full appearance-none bg-orange-500/20 h-1 rounded-full cursor-pointer accent-orange-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
                
                {/* Preview Resizer Handle */}
                <div 
                  className="absolute bottom-0 left-0 right-0 h-1.5 bg-neutral-900 hover:bg-orange-500 cursor-row-resize transition-all z-[60] flex items-center justify-center group"
                  onMouseDown={() => { isResizingPreview.current = true; document.body.style.cursor = "row-resize"; }}
                >
                  <div className="w-12 h-0.5 bg-white/20 rounded-full group-hover:bg-white/40 transition-colors" />
                </div>
              </div>
            )}
          </AnimatePresence>

          {/* Main Workspace Scrollable */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="max-w-[1400px] mx-auto px-8 py-10 space-y-12">
              {segments.length === 0 ? (
                <div
                  className="aspect-video bg-neutral-900 border-2 border-dashed border-neutral-800 rounded-3xl flex flex-col items-center justify-center cursor-pointer group hover:border-orange-500 transition-colors"
                  onClick={() => document.getElementById("init-upload")?.click()}
                >
                  <Upload className="w-16 h-16 text-neutral-700 group-hover:text-orange-500 mb-6 transition-colors" />
                  <p className="text-2xl font-black uppercase tracking-tighter italic opacity-40 group-hover:opacity-100">
                    Load Master Asset
                  </p>
                  <input
                    id="init-upload"
                    type="file"
                    multiple
                    accept="video/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              ) : (
                <>
                  {/* Timeline */}
                  <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8">
                    <div className="space-y-8">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex gap-2 bg-neutral-950 p-1 rounded-lg border border-white/5 overflow-x-auto max-w-full">
                          <button
                            onClick={() => setShowAllMarkers(!showAllMarkers)}
                            className={cn(
                              "px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded border transition-all flex items-center gap-2",
                              showAllMarkers
                                ? "bg-orange-500 text-black border-orange-500"
                                : "border-neutral-800 text-neutral-400 hover:border-white",
                            )}
                            title="Show all markers on timeline"
                          >
                            {showAllMarkers ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                            All
                          </button>
                          <div className="w-[1px] bg-white/5 my-1 mx-1" />
                          {activeSegment?.ranges.map((range, idx) => (
                            <button
                              key={range.id}
                              onClick={() => setActiveRangeIndex(idx)}
                              className={cn(
                                "px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded border transition-all shrink-0",
                                activeRangeIndex === idx
                                  ? "bg-white text-black border-white"
                                  : "border-transparent opacity-40 hover:opacity-100",
                              )}
                            >
                              Marker {idx + 1}
                            </button>
                          ))}
                          <button
                            onClick={addMarker}
                            className="w-10 h-10 flex items-center justify-center text-orange-500 hover:bg-white/10 rounded transition-colors shrink-0"
                            title="Add Cut Marker (Enter)"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex bg-neutral-950 p-1 rounded-lg border border-white/5 border-orange-500/20">
                            <button
                              onClick={() => setZoom((z) => Math.max(z - 0.5, 1))}
                              className="p-2 hover:text-orange-500 transition-colors opacity-60 hover:opacity-100"
                            >
                              <ZoomOut className="w-4 h-4" />
                            </button>
                            <span className="px-3 flex items-center text-[10px] font-mono font-bold opacity-30 uppercase tracking-widest">
                              {zoom.toFixed(1)}x
                            </span>
                            <button
                              onClick={() => setZoom((z) => Math.min(z + 0.5, 10))}
                              className="p-2 hover:text-orange-500 transition-colors opacity-60 hover:opacity-100"
                            >
                              <ZoomIn className="w-4 h-4" />
                            </button>
                          </div>

                          {activeSegment && activeSegment.ranges.length > 1 && (
                            <button
                              onClick={() => deleteMarker(activeRange!.id)}
                              className="text-[10px] font-black uppercase tracking-widest text-red-500 opacity-60 hover:opacity-100 transition-opacity flex items-center gap-2"
                            >
                              <Trash2 className="w-3 h-3" /> Remove
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="relative h-32 bg-neutral-950 rounded-xl border border-white/5 overflow-x-auto custom-scrollbar group touch-pan-x">
                        <div
                          className="relative h-full transition-all duration-300 ease-out flex"
                          style={{ width: `${100 * zoom}%`, minWidth: "100%" }}
                        >
                          {segments.map((seg, sIdx) => (
                            <div 
                              key={seg.id}
                              className={cn(
                                "h-full relative border-r border-white/10 flex transition-all cursor-pointer overflow-hidden",
                                activeSegmentIndex === sIdx ? "bg-orange-500/10 ring-1 ring-inset ring-orange-500/50" : "opacity-40 hover:opacity-60"
                              )}
                              style={{ width: totalOriginalDuration > 0 ? `${(seg.duration / totalOriginalDuration) * 100}%` : "0%" }}
                              onClick={() => setActiveSegmentIndex(sIdx)}
                            >
                              <div className="flex h-full min-w-full">
                                {seg.thumbnails.map((thumb, tIdx) => (
                                  <div key={tIdx} className="flex-1 border-r border-white/5 h-full overflow-hidden">
                                    <img src={thumb} className="w-full h-full object-cover grayscale" />
                                  </div>
                                ))}
                                {seg.type === "audio" && (
                                  <div className="flex-1 flex items-center justify-center opacity-20">
                                    <Music className="w-6 h-6" />
                                  </div>
                                )}
                              </div>

                              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[6px] font-black uppercase tracking-tighter text-white/50 z-50">
                                {seg.file.name.slice(0, 15)}
                              </div>

                              {activeSegmentIndex === sIdx && (
                                <>
                                  <div
                                    className="absolute top-0 bottom-0 w-[2px] bg-white z-40 shadow-[0_0_10px_white] pointer-events-none"
                                    style={{
                                      left: `${(sourceTime / seg.duration) * 100}%`,
                                    }}
                                  />

                                  {seg.ranges.map((range, rIdx) => (
                                    <div
                                      key={range.id}
                                      className={cn(
                                        "absolute h-full z-20",
                                        activeRangeIndex === rIdx ? "bg-orange-500/20 border-x-2 border-orange-500" : "bg-white/5 border-x border-white/20 opacity-30"
                                      )}
                                      style={{
                                        left: `${(range.start / seg.duration) * 100}%`,
                                        width: `${((range.end - range.start) / seg.duration) * 100}%`,
                                      }}
                                    >
                                       {(showAllMarkers || activeRangeIndex === rIdx) && (
                                          <div className="absolute top-1 left-1 text-[8px] font-black opacity-40 uppercase">
                                            #{rIdx + 1}
                                          </div>
                                       )}
                                    </div>
                                  ))}

                                  {activeRange && (
                                    <>
                                      <input
                                        type="range"
                                        min="0"
                                        max={seg.duration}
                                        step="0.01"
                                        value={activeRange.start}
                                        onChange={(e) => updateRangeStart(parseFloat(e.target.value))}
                                        className="absolute w-full h-full appearance-none bg-transparent cursor-pointer pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:bg-orange-500 z-30 [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:cursor-col-resize active:[&::-webkit-slider-thumb]:scale-x-150 transition-all"
                                      />
                                      <input
                                        type="range"
                                        min="0"
                                        max={seg.duration}
                                        step="0.01"
                                        value={activeRange.end}
                                        onChange={(e) => updateRangeEnd(parseFloat(e.target.value))}
                                        className="absolute w-full h-full appearance-none bg-transparent cursor-pointer pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:bg-orange-500 z-30 [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:cursor-col-resize active:[&::-webkit-slider-thumb]:scale-x-150 transition-all"
                                      />
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                          <label className="h-full w-32 flex flex-col items-center justify-center gap-2 bg-neutral-900 hover:bg-orange-500/20 border-l border-white/10 transition-all cursor-pointer group shrink-0 relative z-50">
                             <Plus className="w-8 h-8 text-orange-500 group-hover:scale-125 transition-transform" />
                             <span className="text-[10px] font-black uppercase tracking-widest opacity-40 group-hover:opacity-100">Add Media</span>
                             <input type="file" multiple accept="video/*,image/*,audio/*" className="hidden" onChange={handleFileSelect} />
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-neutral-950 p-6 rounded-2xl border border-white/5 space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-30">Mark In</span>
                            <Scissors className="w-3 h-3 text-orange-500 opacity-40 hover:opacity-100 cursor-pointer" onClick={() => updateRangeStart(sourceTime)} />
                          </div>
                          <div className="space-y-4">
                            <span className="text-4xl font-mono font-black italic tracking-tighter tabular-nums block">
                              {formatTime(activeRange?.start || 0)}
                            </span>
                            <input type="number" step="0.01" value={activeRange?.start || 0} onChange={(e) => updateRangeStart(parseFloat(e.target.value))} className="w-full bg-neutral-900 border border-white/5 rounded p-2 text-[10px] font-mono font-bold focus:border-orange-500 outline-none" />
                          </div>
                        </div>
                        <div className="bg-neutral-950 p-6 rounded-2xl border border-white/5 space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-30">Mark Out</span>
                            <Scissors className="w-3 h-3 text-orange-500 opacity-40 hover:opacity-100 cursor-pointer rotate-180" onClick={() => updateRangeEnd(sourceTime)} />
                          </div>
                          <div className="space-y-4">
                            <span className="text-4xl font-mono font-black italic tracking-tighter tabular-nums block">
                              {formatTime(activeRange?.end || 0)}
                            </span>
                            <input type="number" step="0.01" value={activeRange?.end || 0} onChange={(e) => updateRangeEnd(parseFloat(e.target.value))} className="w-full bg-neutral-900 border border-white/5 rounded p-2 text-[10px] font-mono font-bold focus:border-orange-500 outline-none" />
                          </div>
                        </div>
                        <div className="bg-neutral-100/5 p-6 rounded-2xl border border-orange-500/20 space-y-2 flex flex-col justify-center">
                          <span className="text-[10px] font-black uppercase tracking-widest text-orange-500 block">Trim Duration</span>
                          <span className="text-4xl font-mono font-black italic tracking-tighter tabular-nums">
                            {formatTime((activeRange?.end || 0) - (activeRange?.start || 0))}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Export Controls Area */}
                  <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-10 space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
                      <div className="space-y-4">
                        <h4 className="text-xl font-black uppercase tracking-tighter italic flex items-center gap-2">
                          <Layers className="w-5 h-5 text-orange-500" /> Mode
                        </h4>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { id: "video", label: "Video", icon: FileVideo },
                            { id: "audio", label: "Audio", icon: FileAudio },
                            { id: "gif", label: "GIF", icon: Zap },
                          ].map((t) => (
                            <button key={t.id} onClick={() => setConversionTarget(t.id as any)} className={cn("py-3 flex flex-col items-center justify-center gap-2 text-[8px] font-black uppercase border transition-all rounded", conversionTarget === t.id ? "bg-white text-black border-white shadow-lg" : "border-white/10 opacity-40 hover:opacity-100")}>
                              <t.icon className="w-4 h-4" />
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-xl font-black uppercase tracking-tighter italic">Format & Quality</h4>
                        <div className="flex flex-col gap-2">
                          <div className="grid grid-cols-2 gap-2">
                            {conversionTarget === "video" && ["mp4", "webm"].map(f => (
                              <button key={f} onClick={() => setOutputFormat(f)} className={cn("py-2 text-[9px] font-black uppercase border rounded transition-all", outputFormat === f ? "bg-white text-black border-white" : "border-white/10 opacity-40 hover:opacity-100")}>.{f}</button>
                            ))}
                          </div>
                          <div className="flex gap-1">
                            {[
                              { label: "480p", crf: "35", scale: "854:480" },
                              { label: "720p", crf: "28", scale: "1280:720" },
                              { label: "1080p", crf: "18", scale: "1920:1080" },
                              { label: "4K", crf: "15", scale: "3840:2160" },
                            ].map((q) => (
                              <button key={q.label} onClick={() => setExportQuality(q)} className={cn("flex-1 py-3 text-[8px] font-black uppercase transition-all border rounded", exportQuality.label === q.label ? "bg-orange-500 text-black border-orange-500 shadow-xl" : "border-white/10 opacity-40 hover:opacity-100")}>{q.label}</button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-xl font-black uppercase tracking-tighter italic">Compression</h4>
                        <div className="flex gap-2">
                          {[
                            { id: "none", label: "None" },
                            { id: "medium", label: "Smart" },
                            { id: "high", label: "Ultra" },
                          ].map((c) => (
                            <button key={c.id} onClick={() => setCompressionMode(c.id as any)} className={cn("flex-1 py-3 text-[9px] font-black uppercase border rounded transition-all", compressionMode === c.id ? "bg-white text-black border-white" : "border-white/10 opacity-40 hover:opacity-100")}>{c.label}</button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4 text-right">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Storage Estimate</h4>
                        <div className="flex flex-col text-right gap-2">
                          <div className="flex flex-col">
                             <span className="text-[8px] font-black uppercase opacity-40 tracking-widest">Input Payload</span>
                             <span className="text-lg font-mono font-black italic">
                               {((originalSizeBytes * 8) / (1024 * 1024)).toFixed(1)} <span className="text-orange-500">Mb</span>
                               <span className="mx-2 opacity-20">/</span>
                               {(originalSizeBytes / (1024 * 1024)).toFixed(1)} <span className="text-orange-500">MB</span>
                             </span>
                          </div>
                          <div className="flex flex-col">
                             <span className="text-[8px] font-black uppercase opacity-40 tracking-widest">Output Estimate</span>
                             <span className="text-lg font-mono font-black italic">
                               {((estimatedSizeBytes * 8) / (1024 * 1024)).toFixed(1)} <span className="text-orange-500">Mb</span>
                               <span className="mx-2 opacity-20">/</span>
                               {(estimatedSizeBytes / (1024 * 1024)).toFixed(1)} <span className="text-orange-500">MB</span>
                             </span>
                          </div>
                          <span className="text-4xl font-mono font-black tracking-tighter italic mt-2">~{totalSavedPercentage}% <span className="text-orange-500">SAVED</span></span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleTrim}
                      disabled={isProcessing || segments.length === 0}
                      className={cn("w-full py-10 text-2xl font-black uppercase tracking-[0.5em] italic transition-all relative overflow-hidden group rounded-sm", isProcessing ? "bg-neutral-800 text-neutral-600" : "bg-orange-500 text-black hover:bg-white active:scale-[0.99] shadow-[0_20px_50px_rgba(249,115,22,0.3)]")}
                    >
                      {isProcessing ? (
                      <div className="flex items-center justify-center gap-6">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <span>Rendering Pipeline Buffer</span>
                        <div className="absolute bottom-0 left-0 h-1.5 bg-white transition-all duration-300" style={{ width: `${progress}%` }} />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-6">
                        <Download className="w-8 h-8" />
                        <span>Compile & Commit Output</span>
                      </div>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

        {/* Vertical Resizer */}
        {isSidebarVisible && (
          <div 
            className="w-1 bg-neutral-900 lg:hover:bg-orange-500 cursor-col-resize transition-colors z-50 shrink-0 flex items-center justify-center opacity-40 hover:opacity-100"
            onMouseDown={() => { isResizingSidebar.current = true; document.body.style.cursor = "col-resize"; }}
          >
            <div className="w-[2px] h-12 bg-white/30 rounded-full" />
          </div>
        )}

        <AnimatePresence>
          {isSidebarVisible && (
            <motion.div 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: sidebarWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="shrink-0 border-l border-neutral-900/50 space-y-8 h-full sticky top-0 overflow-y-auto custom-scrollbar px-6 py-4 bg-neutral-950/50 backdrop-blur-xl"
            >
              {/* Sessions Panel */}
              <section className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsSidebarVisible(false)}
                      className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors text-neutral-400 hover:text-white"
                      title="Hide Sidebar"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <h2 className="text-xl font-black uppercase tracking-tighter italic">Sessions</h2>
                  </div>
                  <label className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center cursor-pointer hover:scale-110 active:scale-95 transition-transform shadow-[0_0_15px_rgba(249,115,22,0.4)]">
                    <Plus size={16} className="text-black" />
                    <input
                      type="file"
                      multiple
                      accept="video/*"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </label>
                </div>
            <div className="space-y-3">
              {segments.map((seg, idx) => (
                <div
                  key={seg.id}
                  onClick={() => setActiveSegmentIndex(idx)}
                  className={cn(
                    "group p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden",
                    activeSegmentIndex === idx
                      ? "bg-orange-500/10 border-orange-500/50 shadow-lg shadow-orange-500/5"
                      : "bg-neutral-900 border-white/5 hover:border-white/10 shadow-lg",
                  )}
                >
                  <div className="flex items-center gap-4 relative z-10">
                    <div className="w-12 h-12 bg-neutral-950 rounded-lg overflow-hidden shrink-0 border border-white/5">
                      {seg.thumbnails[0] ? (
                        <img src={seg.thumbnails[0]} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center opacity-20">
                          {seg.type === "video" ? <Video size={16} /> : <Music size={16} />}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest truncate leading-tight">
                        {seg.file.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[8px] font-bold uppercase py-0.5 px-1.5 bg-white/5 rounded-sm opacity-40">
                          {seg.type}
                        </span>
                        <span className="text-[8px] font-bold font-mono opacity-30">
                          {formatTime(seg.duration)}
                        </span>
                        <span className="text-[8px] font-bold font-mono opacity-30 border-l border-white/10 pl-2">
                          {(seg.file.size / (1024 * 1024)).toFixed(1)} MB ({((seg.file.size * 8) / (1024 * 1024)).toFixed(1)} Mb)
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSegment(seg.id);
                      }}
                      className="w-6 h-6 rounded-full bg-red-600/20 text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 hover:text-white"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {activeSegmentIndex === idx && (
                    <motion.div
                      layoutId="active-indicator"
                      className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500"
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Vault Panel */}
          <section className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-xl font-black uppercase tracking-tighter italic opacity-60">Vault</h2>
              <div className="text-[10px] font-mono font-black opacity-30">{gallery.length} ITEMS</div>
            </div>

            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {gallery.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center opacity-10 text-center gap-4 border-2 border-dashed border-white/10 rounded-3xl">
                    <HardDrive className="w-10 h-10" />
                    <p className="text-[8px] font-black uppercase tracking-[0.3em]">Vault Empty</p>
                  </div>
                ) : (
                  gallery.map((v) => (
                    <motion.div
                      key={v.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-neutral-900 border border-white/5 p-4 rounded-2xl group hover:border-orange-500/20 transition-all shadow-lg"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-8 bg-neutral-950 rounded border border-white/5 flex items-center justify-center">
                          <Video className="w-4 h-4 text-neutral-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-tight truncate">
                            {v.name}
                          </p>
                          <div className="flex gap-3 text-[8px] font-bold font-mono opacity-30 uppercase mt-0.5">
                            <span>{formatTime(v.duration)}</span>
                            <span>{(v.size / (1024 * 1024)).toFixed(1)} MB ({((v.size * 8) / (1024 * 1024)).toFixed(1)} Mb)</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={() => downloadVideo(v)}
                          className="flex-1 py-2 bg-neutral-950 hover:bg-white hover:text-black rounded text-[8px] font-black uppercase tracking-widest transition-all"
                        >
                          Download
                        </button>
                        <button
                          onClick={() => handleDelete(v.id)}
                          className="w-8 py-2 bg-neutral-950 hover:bg-neutral-100 hover:text-red-600 rounded flex items-center justify-center transition-all border border-transparent hover:border-red-500/20"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
            </section>
          </motion.div>
        )}
        </AnimatePresence>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 py-8 px-10 flex justify-between items-center text-[10px] font-black uppercase tracking-[0.4em] opacity-20 z-40 bg-neutral-950/20 backdrop-blur-md pointer-events-none">
        <div className="flex gap-10">
          <span>Encoder: PRO-XI</span>
          <span>Buffer: SECURE</span>
        </div>
        <div className="flex gap-10">
          <span>{new Date().toLocaleTimeString()}</span>
          <span>v4.1-ALPHA</span>
        </div>
      </footer>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-neutral-900 border border-white/10 w-full max-w-lg rounded-3xl p-8 relative shadow-2xl space-y-8"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black uppercase tracking-tighter italic">
                  Shortcuts & Control
                </h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-4 h-4 rotate-45" />
                </button>
              </div>

              <div className="space-y-4">
                {Object.entries(shortcuts).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between p-4 bg-neutral-950 rounded-xl border border-white/5 group hover:border-orange-500/30 transition-colors"
                  >
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40">
                      {key.replace(/([A-Z])/g, " $1")}
                    </span>
                    <input
                      type="text"
                      value={value === " " ? "Space" : value}
                      readOnly
                      onKeyDown={(e) => {
                        e.preventDefault();
                        const newKey = e.key === " " ? " " : e.key;
                        setShortcuts((s) => ({ ...s, [key]: newKey }));
                      }}
                      className="bg-neutral-900 border border-white/10 rounded px-4 py-2 text-[10px] font-mono font-black text-orange-500 outline-none text-right cursor-pointer focus:border-orange-500 w-32"
                    />
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-white/5">
                <p className="text-[9px] font-bold uppercase tracking-widest opacity-20 leading-relaxed text-center">
                  Press any key inside the input box to remap. Keyboard control
                  is disabled while typing in numeric fields.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Toast */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-20 left-12 bg-orange-500 text-black px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 z-[100] border-2 border-white/20"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-black uppercase tracking-tighter italic">
              Committed to Vault
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
