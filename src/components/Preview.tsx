import { useEffect, useRef } from 'react';
import { drawComposition } from '../engine/compositor';
import { syncPool } from '../engine/pool';
import { totalDuration, useEditor } from '../state/projectStore';
export default function Preview() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const project = useEditor((s) => s.project);
	const assets = useEditor((s) => s.assets);
	const currentTime = useEditor((s) => s.currentTime);
	const playing = useEditor((s) => s.playing);
	const aspect = useEditor((s) => s.aspect);
	const quality = useEditor((s) => s.previewQuality);
	const rate = useEditor((s) => s.rate);
	const loop = useEditor((s) => s.loop);
	const set = useEditor((s) => s.set);
	const ref = useRef({ project, assets, currentTime, playing, rate, loop });
	ref.current = { project, assets, currentTime, playing, rate, loop };
	const clock = useRef(currentTime);
	const lastSync = useRef(0);
	const lastStore = useRef(currentTime);
	const wasPlaying = useRef(playing);
	useEffect(() => {
		// external scrub while paused: follow immediately (no flash, no jump-back)
		if (!playing) clock.current = currentTime;
		lastStore.current = currentTime;
	}, [currentTime, playing]);
	useEffect(() => {
		const cv = canvasRef.current!;
		const q = quality === 'Half' ? 0.5 : quality === 'Quarter' ? 0.25 : 1;
		if (aspect === '16:9') {
			cv.width = Math.round(960 * q);
			cv.height = Math.round(540 * q);
		} else if (aspect === '9:16') {
			cv.width = Math.round(540 * q);
			cv.height = Math.round(960 * q);
		} else {
			cv.width = Math.round(720 * q);
			cv.height = Math.round(720 * q);
		}
	}, [aspect, quality]);
	useEffect(() => {
		let raf = 0;
		let last = performance.now();
		const loop = (now: number) => {
			raf = requestAnimationFrame(loop);
			const cv = canvasRef.current!;
			if (!cv) return;
			const st = ref.current;
			// pause edge: flush clock -> store once so resume/scrub never jumps back (the flash)
			if (wasPlaying.current && !st.playing) {
				set({ currentTime: clock.current });
				lastStore.current = clock.current;
				lastSync.current = now;
			}
			// play edge: start clock exactly from store time, reset delta
			if (!wasPlaying.current && st.playing) {
				clock.current = st.currentTime;
				lastStore.current = st.currentTime;
				last = now;
			}
			wasPlaying.current = st.playing;
			if (st.playing) {
				// user scrubbed while playing (timeline click / slider): adopt new time
				if (Math.abs(st.currentTime - lastStore.current) > 1e-6 && Math.abs(st.currentTime - clock.current) > 0.25) {
					clock.current = st.currentTime;
				}
				const rawDt = Math.min(0.1, (now - last) / 1000);
				last = now;
				const tot = totalDuration(st.project);
				const r = st.rate || 1;
				// JKL shuttle: negative rate steps backward, >1 fast-forwards
				clock.current += rawDt * r;
				if (clock.current >= tot) {
					if (st.loop && tot > 0.1) {
						clock.current = 0;
						lastStore.current = 0;
						set({ currentTime: 0 });
						lastSync.current = now;
					} else {
						clock.current = tot;
						set({ playing: false, rate: 1, currentTime: tot });
						lastStore.current = tot;
						lastSync.current = now;
					}
				} else if (clock.current < 0) {
					clock.current = st.loop && tot > 0.1 ? tot - 0.05 : 0;
					lastStore.current = clock.current;
					set({ currentTime: clock.current });
				} else if (now - lastSync.current > 100) {
					lastSync.current = now;
					lastStore.current = clock.current;
					set({ currentTime: clock.current });
				}
			} else {
				last = now;
				// paused: hard-follow store (scrub) but never snap back after pause-flush
				if (Math.abs(st.currentTime - lastStore.current) > 1e-6) lastStore.current = st.currentTime;
				if (Math.abs(clock.current - st.currentTime) > 1e-6) clock.current = st.currentTime;
			}
			const t = clock.current;
			try {
				syncPool(st.project, st.assets, t, st.playing, st.rate || 1);
				drawComposition(st.project, st.assets, t, cv);
			} catch { /* keep last frame on error = no black flash */ }
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [set]);
	const onCanvasDown = (e: React.MouseEvent) => {
		const cv = canvasRef.current!;
		const r = cv.getBoundingClientRect();
		const mx = (e.clientX - r.left) / r.width,
			my = (e.clientY - r.top) / r.height;
		const st = useEditor.getState();
		const t = st.currentTime;
		const textHits: { tr: string; c: (typeof st.project.tracks[number]['clips'][number]) }[] = [];
		for (const tr of st.project.tracks.filter((x) => x.id[0] === 't')) {
			for (const c of tr.clips.filter((c) => t >= c.startTime && t < c.startTime + c.duration)) {
				if (Math.abs(mx - c.position.x) < 0.25 && Math.abs(my - c.position.y) < 0.2) textHits.push({ tr: tr.id, c });
			}
		}
		const ovHits: { tr: string; c: (typeof st.project.tracks[number]['clips'][number]) }[] = [];
		for (const tr of st.project.tracks.filter((x) => x.id[0] === 'v')) {
			if (tr.id === 'v1') continue; // base track not draggable overlays only... still allow topmost v* below
			for (const c of tr.clips.filter((c) => t >= c.startTime && t < c.startTime + c.duration)) {
				if (Math.abs(mx - (0.5 + c.position.x)) < 0.2 && Math.abs(my - (0.5 + c.position.y)) < 0.2) ovHits.push({ tr: tr.id, c });
			}
		}
		const hit = textHits[textHits.length - 1] ?? ovHits[ovHits.length - 1] ?? null;
		if (!hit) return;
		st.set({ selected: { trackId: hit.tr, clipId: hit.c.id } });
		const before = JSON.stringify(st.project);
		const mv = (ev: MouseEvent) => {
			const rr = cv.getBoundingClientRect();
			const nx = Math.max(0, Math.min(1, (ev.clientX - rr.left) / rr.width));
			const ny = Math.max(0, Math.min(1, (ev.clientY - rr.top) / rr.height));
			const s2 = useEditor.getState();
			s2.set({
				project: {
					...s2.project,
					tracks: s2.project.tracks.map((tr) =>
						tr.id === hit.tr
							? {
									...tr,
									clips: tr.clips.map((c) =>
										c.id === hit.c.id
											? {
													...c,
													position:
														hit.tr[0] === 't'
															? { x: nx, y: ny }
															: { x: nx - 0.5, y: ny - 0.5 },
												}
											: c,
									),
								}
							: tr,
					),
				},
			});
		};
		const up = () => {
			document.removeEventListener('mousemove', mv);
			document.removeEventListener('mouseup', up);
			const s3 = useEditor.getState();
			s3.set({
				undoStack: [
					...s3.undoStack.slice(-59),
					{
						label: 'Move',
						before,
						after: JSON.stringify(s3.project),
						at: Date.now(),
					},
				],
				redoStack: [],
			});
		};
		document.addEventListener('mousemove', mv);
		document.addEventListener('mouseup', up);
	};
	const onWheel = (e: React.WheelEvent) => {
		const st = useEditor.getState();
		const sel = st.selected;
		if (!sel) return;
		const c = st.project.tracks
			.find((t) => t.id === sel.trackId)
			?.clips.find((x) => x.id === sel.clipId);
		if (!c || (sel.trackId[0] !== 'v' && c.type !== 'text')) return;
		st.commit('Scale', (p) => ({
			...p,
			tracks: p.tracks.map((t) =>
				t.id === sel.trackId
					? {
							...t,
							clips: t.clips.map((x) =>
								x.id === sel.clipId
									? {
											...x,
											scale: {
												x: Math.max(
													0.1,
													Math.min(4, x.scale.x * (e.deltaY > 0 ? 0.95 : 1.05)),
												),
												y: 1,
											},
										}
									: x,
							),
						}
					: t,
			),
		}));
	};
	return (
		<div className="flex-1 flex items-center justify-center bg-[#0e1013] p-3 min-h-0">
			<canvas
				ref={canvasRef}
				id="preview-canvas"
				width={960}
				height={540}
				onMouseDown={onCanvasDown}
				onWheel={onWheel}
				className="bg-black rounded-lg border border-[#2c313b] max-w-full max-h-full"
			/>
		</div>
	);
}
