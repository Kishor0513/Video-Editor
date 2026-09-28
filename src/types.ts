export type TrackType = 'video' | 'audio' | 'text' | 'caption' | 'overlay';
export type ClipType = 'video' | 'image' | 'audio' | 'text' | 'caption' | 'sticker' | 'shape' | 'adjustment' | 'compound';
export interface Effect { id: string; name: string; category: string; params: Record<string, number>; }
export interface FilterState { br: number; ct: number; st: number; gr: number; sp: number; bl: number; intensity?: number; }
export interface Keyframe { id: string; dt: number; prop: string; value: number; easing?: string; }
export interface Transition { type: 'fade' | 'wipe' | 'slide' | 'dissolve' | 'glitch' | 'zoom' | 'blur' | 'circle' | 'pixelate' | 'light'; duration: number; }
export interface Clip {
  id: string; assetId?: string; type: ClipType;
  startTime: number; duration: number; sourceStart?: number; sourceDuration?: number;
  position: { x: number; y: number }; scale: { x: number; y: number };
  rotation: number; opacity: number; volume?: number; speed?: number;
  effects?: Effect[]; filters?: FilterState; keyframes?: Keyframe[];
  transitionIn?: Transition; crop?: { x: number; y: number; w: number; h: number };
  text?: string; fontSize?: number; color?: string; textAlign?: CanvasTextAlign; anim?: string;
  stroke?: string; strokeW?: number; shadow?: number; bgColor?: string;
  shape?: 'rect' | 'circle' | 'triangle' | 'star';
  sub?: Clip[];
  trackId: string; fadeIn?: number; fadeOut?: number; vignette?: number; flipH?: boolean; bgBlur?: boolean;
  chroma?: { enabled: boolean; color: string; similarity: number; smoothness: number };
  mask?: { shape: 'rect' | 'circle'; feather: number; opacity: number };
  speedCurve?: 'Montage' | 'Bullet' | 'Jump Cut' | 'Hero' | 'Flash In' | 'Flash Out' | 'Custom';
  blend?: GlobalCompositeOperation;
  pan?: number;
  pitch?: number;
  ducking?: boolean;
  audioFX?: { eqLow: number; eqMid: number; eqHigh: number; comp: number; reverb: number; denoise: number };
  lutIntensity?: number;
}
export interface Track { id: string; type: TrackType; name: string; locked: boolean; muted: boolean; visible: boolean; clips: Clip[]; }
export interface Asset { id: string; kind: 'video' | 'image' | 'audio'; name: string; url: string; duration: number; width: number; height: number; thumb: string; peaks?: number[]; proxyUrl?: string; }
export interface Project {
  id: string; name: string;
  settings: { width: number; height: number; fps: number; duration: number; background: string };
  tracks: Track[]; markers: { id: string; time: number; label: string }[];
  createdAt: string; updatedAt: string;
}
export const timeToFrame = (t: number, fps: number) => Math.floor(t * fps + 1e-6);
export const frameToTime = (f: number, fps: number) => f / fps;
