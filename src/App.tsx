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
  RotateCw,
  Copy,
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
  status?: 'processing' | 'ready' | 'error';
  loadProgress?: number;
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

  const [outputFormat, setOutputFormat] = useState<string>("mp4");
  const [compressionMode, setCompressionMode] = useState<"none" | "medium" | "high">("none");
  const [conversionTarget, setConversionTarget] = useState<"video" | "audio" | "gif">("video");
  const [previewMode, setPreviewMode] = useState<"dual" | "single">("dual");
  const [activePreviewTab, setActivePreviewTab] = useState<"source" | "preview">("source");
  const [sidebarOrientation, setSidebarOrientation] = useState<"vertical" | "horizontal">("horizontal");

  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [isSourcePlaying, setIsSourcePlaying] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  
  const isResizingTimeline = useRef(false);
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
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [activeVaultVideo, setActiveVaultVideo] = useState<TrimmedVideo | null>(null);
  const [draggedSegmentIndex, setDraggedSegmentIndex] = useState<number | null>(null);

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
      
      let inferredType: AssetType = "video";
      if (file.type.startsWith("image/")) {
        inferredType = file.type === "image/gif" ? "gif" : "image";
      } else if (file.type.startsWith("audio/")) {
        inferredType = "audio";
      }
      
      const newSegment: VideoSegment = {
        id: crypto.randomUUID(),
        file,
        type: inferredType,
        url,
        duration: 0,
        ranges: [],
        thumbnails: [],
        status: 'processing',
        loadProgress: 0
      };

      setSegments(prev => [...prev, newSegment]);

      // Background metadata & thumb processing
      (async () => {
        let duration = 0;
        let thumbnails: string[] = [];

        try {
          if (inferredType === "video") {
            // Simulate realistic progress using an asymptotic curve based on file size
            // Larger files will progress slower
            const factor = file.size > 100 * 1024 * 1024 ? 0.02 : 0.08;
            const progressInterval = setInterval(() => {
              setSegments(prev => prev.map(s => {
                if (s.id === newSegment.id) {
                  const current = s.loadProgress || 0;
                  const next = current + (99 - current) * factor;
                  return { ...s, loadProgress: Math.min(Math.round(next), 99) };
                }
                return s;
              }));
            }, 500);

            const tempVideo = document.createElement("video");
            tempVideo.src = url;
            await new Promise((r) => (tempVideo.onloadedmetadata = r));
            duration = tempVideo.duration;
            thumbnails = await generateThumbnails(file, duration);
            
            clearInterval(progressInterval);
          } else if (inferredType === "audio") {
            const tempAudio = new Audio(url);
            await new Promise((r) => (tempAudio.onloadedmetadata = r));
            duration = tempAudio.duration;
          } else if (inferredType === "image" || inferredType === "gif") {
            duration = 5; // Default 5 seconds for static images/gifs
            thumbnails = Array(5).fill(url);
          }

          setSegments(prev => prev.map(s => s.id === newSegment.id ? {
            ...s,
            duration,
            ranges: [{ id: crypto.randomUUID(), start: 0, end: duration }],
            thumbnails,
            status: 'ready',
            loadProgress: 100
          } : s));
        } catch (err) {
          console.error("Background processing error:", err);
        }
      })();
    }
  };

  // Global Mouse Events for Resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingPreview.current) {
        setPreviewHeight(Math.max(200, Math.min(800, e.clientY - 100)));
      }
      if (isResizingTimeline.current) {
        // Adjust height relative to current container position
        const timelineElement = document.querySelector(".timeline-container");
        if (timelineElement) {
          const rect = timelineElement.getBoundingClientRect();
          setTimelineHeight(Math.max(150, Math.min(600, e.clientY - rect.top)));
        }
      }
    };

    const handleMouseUp = () => {
      isResizingPreview.current = false;
      isResizingTimeline.current = false;
      document.body.style.cursor = "default";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

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
              "-tune", "fastdecode",
              "-threads", "4",
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
              "-tune", "fastdecode",
              "-threads", "4",
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
              "-tune", "fastdecode",
              "-threads", "4",
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

  const duplicateSegment = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const segToCopy = segments[index];
    const newSeg: VideoSegment = {
      ...segToCopy,
      id: crypto.randomUUID(),
      ranges: segToCopy.ranges.map(r => ({ ...r, id: crypto.randomUUID() }))
    };
    const newSegments = [...segments];
    newSegments.splice(index + 1, 0, newSeg);
    setSegments(newSegments);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
    setDraggedSegmentIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDraggedSegmentIndex(null);
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(dragIndex) || dragIndex === dropIndex) return;

    const newSegments = [...segments];
    const [draggedItem] = newSegments.splice(dragIndex, 1);
    newSegments.splice(dropIndex, 0, draggedItem);
    
    setSegments(newSegments);
    if (activeSegmentIndex === dragIndex) {
      setActiveSegmentIndex(dropIndex);
    } else if (activeSegmentIndex === dropIndex) {
      setActiveSegmentIndex(dragIndex);
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
                  className="bg-neutral-950/80 backdrop-blur-2xl border-b border-neutral-900 shadow-2xl z-40 px-8 py-4 overflow-hidden flex flex-col"
                >
                  {/* Mode Toggles */}
                  <div className="flex justify-end gap-2 mb-4">
                    <button 
                      onClick={() => setPreviewMode(previewMode === "dual" ? "single" : "dual")}
                      className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-full text-[8px] font-black uppercase tracking-widest border border-white/10 transition-all flex items-center gap-2"
                    >
                      <Layers size={10} className="text-orange-500" />
                      {previewMode === "dual" ? "Dual View" : "Single View"}
                    </button>
                    {previewMode === "single" && (
                       <div className="flex bg-neutral-900 p-0.5 rounded-full border border-white/5">
                         <button 
                           onClick={() => setActivePreviewTab("source")}
                           className={cn("px-4 py-1 rounded-full text-[8px] font-black uppercase tracking-widest transition-all", activePreviewTab === "source" ? "bg-white text-black" : "text-white/40")}
                         >
                           Source
                         </button>
                         <button 
                           onClick={() => setActivePreviewTab("preview")}
                           className={cn("px-4 py-1 rounded-full text-[8px] font-black uppercase tracking-widest transition-all", activePreviewTab === "preview" ? "bg-orange-500 text-black" : "text-white/40")}
                         >
                           Preview
                         </button>
                       </div>
                    )}
                  </div>

                  <div className={cn(
                    "max-w-[1400px] mx-auto gap-8 flex-1 min-h-0",
                    previewMode === "dual" ? "grid grid-cols-1 md:grid-cols-2" : "flex justify-center"
                  )}>
                    {/* Source Player */}
                    {(previewMode === "dual" || activePreviewTab === "source") && (
                      <div className={cn("flex flex-col gap-4 min-h-0", previewMode === "single" ? "w-full max-w-4xl" : "")}>
                        <div className="relative flex-1 bg-black rounded-2xl overflow-hidden border border-neutral-800 group/player shadow-2xl">
                          <video
                            ref={videoRef}
                            src={activeSegment?.url}
                            className="w-full h-full object-contain"
                            onTimeUpdate={handleSourceTimeUpdate}
                          />
                          <div className="absolute top-4 left-4 font-black uppercase tracking-widest text-[10px] bg-black/60 px-3 py-1 rounded border border-white/10 backdrop-blur-md z-10">
                            Master Source
                          </div>
                          
                          {/* Embedded Seek Bar Overlay */}
                          <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent translate-y-2 opacity-0 group-hover/player:translate-y-0 group-hover/player:opacity-100 transition-all z-20">
                            <div className="flex items-center gap-4">
                              <button
                                onClick={toggleSourcePlay}
                                className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-transform shrink-0 shadow-xl"
                              >
                                {isSourcePlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5 fill-current" />}
                              </button>
                              <div className="flex-1 space-y-1">
                                <div className="flex justify-between text-[8px] font-mono font-bold text-white/60 uppercase">
                                  <span>{formatTime(sourceTime)}</span>
                                  <span>{formatTime(activeSegment?.duration || 0)}</span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max={activeSegment?.duration || 0}
                                  step="0.01"
                                  value={sourceTime}
                                  onChange={(e) => handleSourceSeek(parseFloat(e.target.value))}
                                  className="w-full appearance-none bg-white/20 h-1 rounded-full cursor-pointer accent-white hover:h-2 transition-all"
                                />
                              </div>
                              <button 
                                onClick={() => toggleFullscreen(videoRef)}
                                className="p-2.5 bg-black/40 hover:bg-white/20 rounded-xl transition-all text-white backdrop-blur-md border border-white/10"
                              >
                                <Maximize size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Preview Player */}
                    {(previewMode === "dual" || activePreviewTab === "preview") && (
                      <div className={cn("flex flex-col gap-4 min-h-0", previewMode === "single" ? "w-full max-w-4xl" : "")}>
                        <div className="relative flex-1 bg-neutral-900 rounded-2xl overflow-hidden border border-orange-500/30 group/player shadow-2xl">
                          <video
                            ref={previewRef}
                            src={activeSegment?.url}
                            className="w-full h-full object-contain"
                            onTimeUpdate={handlePreviewTimeUpdate}
                          />
                          <div className="absolute top-4 left-4 font-black uppercase tracking-widest text-[10px] bg-orange-600 px-3 py-1 rounded text-white shadow-lg backdrop-blur-md z-10">
                            Trim Preview
                          </div>

                          {/* Embedded Seek Bar Overlay */}
                          <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-orange-950/60 to-transparent translate-y-2 opacity-0 group-hover/player:translate-y-0 group-hover/player:opacity-100 transition-all z-20">
                            <div className="flex items-center gap-4">
                              <button
                                onClick={togglePreviewPlay}
                                className="w-10 h-10 bg-orange-500 text-black rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-transform shrink-0 shadow-xl"
                              >
                                {isPreviewPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5 fill-current" />}
                              </button>
                              <div className="flex-1 space-y-1">
                                <div className="flex justify-between text-[8px] font-mono font-bold text-orange-500/60 uppercase">
                                  <span>{formatTime(previewTime - (activeRange?.start || 0))}</span>
                                  <span>{formatTime((activeRange?.end || 0) - (activeRange?.start || 0))}</span>
                                </div>
                                <input
                                  type="range"
                                  min={activeRange?.start || 0}
                                  max={activeRange?.end || 0}
                                  step="0.01"
                                  value={previewTime}
                                  onChange={(e) => handlePreviewSeek(parseFloat(e.target.value))}
                                  className="w-full appearance-none bg-orange-500/30 h-1 rounded-full cursor-pointer accent-orange-500 hover:h-2 transition-all"
                                />
                              </div>
                              <button 
                                onClick={() => toggleFullscreen(previewRef)}
                                className="p-2.5 bg-black/40 hover:bg-orange-500 rounded-xl transition-all text-white backdrop-blur-md border border-white/10"
                              >
                                <Maximize size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
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
                    <div 
                      className={cn(
                        "bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden flex relative timeline-container",
                        sidebarOrientation === "vertical" ? "flex-row" : "flex-col"
                      )}
                      style={{ height: sidebarOrientation === "vertical" ? `${timelineHeight}px` : "auto" }}
                    >
                      {/* Height Resize Handle (Bottom) */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize bg-transparent hover:bg-orange-500/50 transition-colors z-[60]"
                        onMouseDown={() => {
                          isResizingTimeline.current = true;
                          document.body.style.cursor = "ns-resize";
                        }}
                      />
                      
                      {/* Vertical Sidebar Controls - Constrained Height */}
                      {/* Controls Sidebar/Bottom Bar */}
                      <div className={cn(
                        "shrink-0 bg-neutral-950 border-white/5 flex items-center z-50 transition-all duration-300",
                        sidebarOrientation === "vertical" 
                          ? "w-14 flex-col border-r py-6 gap-6 h-full" 
                          : "w-full flex-row border-t px-6 gap-6 h-14 order-last"
                      )}>
                        <div className={cn("flex gap-2 shrink-0", sidebarOrientation === "vertical" ? "flex-col" : "flex-row")}>
                          <button
                            onClick={() => setShowAllMarkers(!showAllMarkers)}
                            className={cn(
                              "w-10 h-10 flex items-center justify-center rounded-xl border transition-all",
                              showAllMarkers
                                ? "bg-orange-500 text-black border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]"
                                : "border-neutral-800 text-neutral-500 hover:border-white/20",
                            )}
                            title="Show all markers"
                          >
                            {showAllMarkers ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          </button>
                          
                          <button
                            onClick={addMarker}
                            className="w-10 h-10 flex items-center justify-center text-orange-500 hover:bg-white/10 rounded-xl border border-white/5 transition-all"
                            title="Add Marker (Enter)"
                          >
                            <Plus className="w-4 h-4" />
                          </button>

                          {activeSegment && activeSegment.ranges.length > 1 && (
                            <button
                              onClick={() => deleteMarker(activeRange!.id)}
                              className="w-10 h-10 flex items-center justify-center text-red-500 hover:bg-red-500/10 rounded-xl border border-white/5 transition-all"
                              title="Delete Marker"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        <div className={cn("bg-white/5 shrink-0", sidebarOrientation === "vertical" ? "w-8 h-[1px]" : "h-8 w-[1px]")} />

                        {/* Zoom Controls */}
                        <div className={cn(
                          "flex items-center bg-neutral-900/50 rounded-xl border border-white/5 p-1 gap-1 shrink-0",
                          sidebarOrientation === "vertical" ? "flex-col" : "flex-row"
                        )}>
                          <button
                            onClick={() => setZoom((z) => Math.min(z + 0.5, 10))}
                            className="p-2 hover:text-orange-500 transition-colors"
                            title="Zoom In"
                          >
                            <ZoomIn className="w-4 h-4" />
                          </button>
                          <span className={cn(
                            "text-[8px] font-mono font-bold opacity-30 py-1",
                            sidebarOrientation === "vertical" ? "origin-center -rotate-90" : "px-1"
                          )}>
                            {zoom.toFixed(1)}x
                          </span>
                          <button
                            onClick={() => setZoom((z) => Math.max(z - 0.5, 1))}
                            className="p-2 hover:text-orange-500 transition-colors"
                            title="Zoom Out"
                          >
                            <ZoomOut className="w-4 h-4" />
                          </button>
                        </div>

                        <div className={cn("bg-white/5 shrink-0", sidebarOrientation === "vertical" ? "w-8 h-[1px]" : "h-8 w-[1px]")} />

                        {/* Marker List - Scrollable */}
                        <div className={cn(
                          "flex-1 flex gap-2 overflow-auto custom-scrollbar min-h-0 min-w-0 pb-1",
                          sidebarOrientation === "vertical" ? "flex-col w-full px-2" : "flex-row items-center h-full"
                        )}>
                          {activeSegment?.ranges.map((range, idx) => (
                            <button
                              key={range.id}
                              onClick={() => setActiveRangeIndex(idx)}
                              className={cn(
                                "flex items-center justify-center text-[10px] font-black rounded-lg transition-all shrink-0 border",
                                sidebarOrientation === "vertical" ? "w-9 h-9" : "h-9 px-4",
                                activeRangeIndex === idx
                                  ? "bg-white text-black border-white shadow-lg"
                                  : "bg-neutral-900 text-white/20 border-white/5 hover:text-white hover:bg-white/10",
                              )}
                            >
                              {idx + 1}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Main Timeline Content */}
                      <div className="flex-1 min-w-0 flex flex-col">
                        {/* Timeline Ruler - Taller for better clicking */}
                        <div className="relative h-10 bg-neutral-900/40 border-b border-white/10 overflow-hidden group/ruler">
                          <div 
                            className="relative h-full flex items-end cursor-crosshair"
                            style={{ width: `${100 * zoom}%`, minWidth: "100%" }}
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const x = e.clientX - rect.left;
                              const percentage = x / rect.width;
                              if (activeSegment) {
                                handleSourceSeek(percentage * activeSegment.duration);
                              }
                            }}
                          >
                            {activeSegment && Array.from({ length: Math.ceil(activeSegment.duration) + 1 }).map((_, i) => (
                              <div 
                                key={i} 
                                className="absolute bottom-0 border-l border-white/10 group pointer-events-none"
                                style={{ 
                                  left: `${(i / activeSegment.duration) * 100}%`,
                                  height: i % 5 === 0 ? "100%" : "40%"
                                }}
                              >
                                {i % 5 === 0 && (
                                  <span className="absolute bottom-full left-1 text-[6px] font-mono font-bold opacity-20 group-hover:opacity-100 transition-opacity">
                                    {formatTime(i)}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                         <div className="relative flex-1 bg-neutral-950 border-b border-white/5 overflow-x-auto custom-scrollbar group touch-pan-x min-h-0">
                          <div
                            className="relative h-full transition-all duration-300 ease-out flex"
                            style={{ width: `${100 * zoom}%`, minWidth: "100%" }}
                          >
                            {/* Sticky Add Media Button - Styled like right button */}
                            <label className="sticky left-0 z-[60] h-full w-32 flex flex-col items-center justify-center gap-2 bg-neutral-950/80 backdrop-blur-md border-r border-white/10 transition-all cursor-pointer group shrink-0">
                               <Plus size={24} className="text-orange-500 group-hover:scale-125 transition-transform" />
                               <span className="text-[10px] font-black uppercase tracking-widest opacity-40 group-hover:opacity-100">Add Media</span>
                               <input type="file" multiple accept="video/*,image/*,audio/*" className="hidden" onChange={handleFileSelect} />
                            </label>

                            {segments.map((seg, sIdx) => (
                              <div 
                                key={seg.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, sIdx)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, sIdx)}
                                className={cn(
                                  "h-full relative border-r border-white/10 flex transition-all cursor-pointer overflow-hidden group/segment",
                                  activeSegmentIndex === sIdx ? "bg-orange-500/10 ring-1 ring-inset ring-orange-500/50" : "opacity-40 hover:opacity-60",
                                  draggedSegmentIndex === sIdx ? "opacity-20 scale-95" : ""
                                )}
                                style={{ width: totalOriginalDuration > 0 ? `${(seg.duration / totalOriginalDuration) * 100}%` : "0%" }}
                                onClick={(e) => {
                                  setActiveSegmentIndex(sIdx);
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const x = e.clientX - rect.left;
                                  const percentage = x / rect.width;
                                  handleSourceSeek(percentage * seg.duration);
                                }}
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

                                <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[6px] font-black uppercase tracking-tighter text-white/50 z-50 pointer-events-none">
                                  {seg.file.name.slice(0, 15)}
                                </div>

                                <button
                                  onClick={(e) => duplicateSegment(e, sIdx)}
                                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-orange-500 text-white hover:text-black rounded flex items-center justify-center opacity-0 group-hover/segment:opacity-100 transition-all z-[60]"
                                  title="Duplicate Media"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>

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
                                          "absolute h-full z-20 transition-colors",
                                          activeRangeIndex === rIdx 
                                            ? "bg-orange-500/40 border-x-[3px] border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.3)]" 
                                            : "bg-orange-500/10 border-x border-orange-500/30 opacity-60"
                                        )}
                                        style={{
                                          left: `${(range.start / seg.duration) * 100}%`,
                                          width: `${((range.end - range.start) / seg.duration) * 100}%`,
                                        }}
                                      >
                                         {(showAllMarkers || activeRangeIndex === rIdx) && (
                                            <div className="absolute top-1 left-2 bg-orange-500 text-black px-1 rounded text-[8px] font-black uppercase shadow-lg">
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
                                        onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        draggable={true}
                                        className="absolute w-full h-full appearance-none bg-transparent cursor-pointer pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:bg-orange-500 z-30 [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:cursor-col-resize active:[&::-webkit-slider-thumb]:scale-x-150 transition-all"
                                      />
                                      <input
                                        type="range"
                                        min="0"
                                        max={seg.duration}
                                        step="0.01"
                                        value={activeRange.end}
                                        onChange={(e) => updateRangeEnd(parseFloat(e.target.value))}
                                        onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        draggable={true}
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

                      {/* Integrated Controls Below Ruler */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-2 bg-neutral-950/50 rounded-b-xl border-x border-b border-white/5">
                        <div className="bg-neutral-900/50 p-4 rounded-lg border border-white/5 flex items-center justify-between group hover:border-orange-500/50 transition-all">
                          <div className="flex flex-col">
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-30">Mark In</span>
                            <span className="text-xl font-mono font-black italic tracking-tighter tabular-nums text-white group-hover:text-orange-500">
                              {formatTime(activeRange?.start || 0)}
                            </span>
                          </div>
                          <button 
                            onClick={() => updateRangeStart(sourceTime)}
                            className="p-3 bg-white/5 hover:bg-orange-500 rounded-full transition-all text-white/40 hover:text-white"
                          >
                            <Scissors size={14} />
                          </button>
                        </div>

                        <div className="bg-neutral-900/50 p-4 rounded-lg border border-white/5 flex items-center justify-between group hover:border-orange-500/50 transition-all">
                          <div className="flex flex-col">
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-30">Mark Out</span>
                            <span className="text-xl font-mono font-black italic tracking-tighter tabular-nums text-white group-hover:text-orange-500">
                              {formatTime(activeRange?.end || 0)}
                            </span>
                          </div>
                          <button 
                            onClick={() => updateRangeEnd(sourceTime)}
                            className="p-3 bg-white/5 hover:bg-orange-500 rounded-full transition-all text-white/40 hover:text-white"
                          >
                            <Scissors size={14} className="rotate-180" />
                          </button>
                        </div>

                        <div className="bg-neutral-900/50 p-4 rounded-lg border border-white/5 flex items-center justify-between group hover:border-orange-500/50 transition-all">
                          <div className="flex flex-col">
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-30">Copy</span>
                            <span className="text-xl font-mono font-black italic tracking-tighter tabular-nums text-white group-hover:text-orange-500">
                              Clone
                            </span>
                          </div>
                          <button 
                            onClick={(e) => duplicateSegment(e, activeSegmentIndex)}
                            className="p-3 bg-white/5 hover:bg-orange-500 rounded-full transition-all text-white/40 hover:text-white"
                            title="Duplicate active media"
                          >
                            <Copy size={14} />
                          </button>
                        </div>

                        <div className="bg-orange-500/5 p-4 rounded-lg border border-orange-500/20 flex flex-col justify-center">
                          <span className="text-[8px] font-black uppercase tracking-widest text-orange-500/60 block">Trim Duration</span>
                          <span className="text-xl font-mono font-black italic tracking-tighter tabular-nums text-orange-500">
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

                    <div className="relative group">
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
                    
                    {isProcessing && (
                      <button 
                        onClick={() => setShowCancelConfirm(true)}
                        className="absolute -top-4 -right-4 w-12 h-12 bg-red-600 text-white rounded-full flex items-center justify-center hover:bg-red-500 hover:scale-110 active:scale-95 transition-all shadow-xl z-[70] border-4 border-neutral-900"
                        title="Cancel Rendering"
                      >
                        <Plus className="w-6 h-6 rotate-45" />
                      </button>
                    )}
                  </div>
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
                    <div className="w-12 h-12 bg-neutral-950 rounded-lg overflow-hidden shrink-0 border border-white/5 relative">
                      {seg.status === 'processing' ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-orange-500/10">
                          <Loader2 size={16} className="text-orange-500 animate-spin mb-1" />
                          <span className="text-[8px] font-mono font-black text-orange-500">
                            {seg.loadProgress}%
                          </span>
                        </div>
                      ) : seg.thumbnails[0] ? (
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
                  <div className="py-12 flex flex-col items-center justify-center opacity-40 hover:opacity-80 transition-opacity text-center gap-4 border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-3xl cursor-pointer">
                    <img src="/empty-vault.png" alt="Empty Vault" className="w-16 h-16 object-contain" />
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
                          onClick={() => setActiveVaultVideo(v)}
                          className="w-10 h-10 flex items-center justify-center bg-orange-500 text-black rounded hover:bg-white transition-all"
                          title="Play Video"
                        >
                          <Play className="w-4 h-4" />
                        </button>
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
          <div className="fixed inset-0 z-[200] flex items-center justify-end p-8">
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

       {/* Cancel Confirmation Modal */}
      <AnimatePresence>
        {showCancelConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-neutral-900 border border-red-500/50 w-full max-w-md rounded-3xl p-10 relative shadow-2xl space-y-8 text-center"
            >
              <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-10 h-10 text-red-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black uppercase tracking-tighter italic">Abort Rendering?</h3>
                <p className="text-xs font-bold uppercase tracking-widest opacity-40 leading-relaxed">
                  All progress will be lost. This process cannot be resumed.
                </p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 py-4 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Continue Render
                </button>
                <button
                  onClick={() => {
                    window.location.reload(); // Hard reset for FFmpeg safety
                  }}
                  className="flex-1 py-4 bg-red-600 hover:bg-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Confirm Abort
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Vault Video Player Modal */}
      <AnimatePresence>
        {activeVaultVideo && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-10">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveVaultVideo(null)}
              className="absolute inset-0 bg-black/95 backdrop-blur-2xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-5xl aspect-video bg-black rounded-3xl overflow-hidden relative shadow-2xl border border-white/5"
            >
              <video 
                src={URL.createObjectURL(activeVaultVideo.blob)} 
                controls 
                autoPlay 
                className="w-full h-full"
              />
              <button
                onClick={() => setActiveVaultVideo(null)}
                className="absolute top-6 right-6 w-12 h-12 rounded-full bg-black/50 hover:bg-white/20 flex items-center justify-center transition-colors text-white z-50 backdrop-blur-md"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
              <div className="absolute bottom-6 left-6 px-6 py-3 bg-black/50 backdrop-blur-md rounded-xl border border-white/10">
                <p className="text-xs font-black uppercase tracking-widest italic">{activeVaultVideo.name}</p>
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
