import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { attachMap, parkMap } from '../map/mapSingleton';
import { getJudgeTargetSpots, getStationsByOrder, loadGame, saveGame } from '../db/repo';
import type { Spot, Station } from '../types';
import { haversineMeters } from '../utils/geo';
import { useGameStore } from '../store/gameStore';
import { useToast } from '../hooks/useToast';
import { useOnline } from '../hooks/useOnline';
import { getCurrentFix } from '../logic/location';
import { CHECKIN_RADIUS_M, JR_COOLDOWN_SEC, MAX_ACCURACY_M, checkInSpotOrCp, goalCheckIn, jrAlight, jrBoard } from '../logic/game';
import { MarkerClusterer } from '@googlemaps/markerclusterer';

export default function PlayPage() {
  const nav = useNavigate();
  const online = useOnline();
  const { show, Toast } = useToast();

  const progress = useGameStore(s => s.progress);
  const setProgress = useGameStore(s => s.setProgress);
  const remainingSec = useGameStore(s => s.remainingSec);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [checkInBusy, setCheckInBusy] = useState(false);

  // Debug tools & event log (off by default in prod).
  const DEBUG_TOOLS = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const enabledByQuery = q.get('debug') === '1';
    const gate = (import.meta.env.VITE_DEBUG_TOOLS as string | undefined) ?? '1';
    return gate !== '0' && (import.meta.env.DEV || enabledByQuery);
  }, []);

  useEffect(() => {
    useVirtualRef.current = useVirtualLoc;
  }, [useVirtualLoc]);

  useEffect(() => {
    const map = mapRef.current;
    if (!DEBUG_TOOLS || !map) return;
    if (useVirtualLoc) ensureVirtualMarker(map);
    else disableVirtualMarker();
  }, [DEBUG_TOOLS, useVirtualLoc]);


  type LogEntry = { atMs: number; type: string; message: string; data?: any };
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const pushLog = (type: string, message: string, data?: any) => {
    if (!DEBUG_TOOLS) return;
    const entry: LogEntry = { atMs: Date.now(), type, message, data };
    setLogs(prev => [entry, ...prev].slice(0, 400));
    // Keep in console for copy/paste during field tests.
    // eslint-disable-next-line no-console
    console.log('[DBG]', type, message, data ?? '');
  };

  const [useVirtualLoc, setUseVirtualLoc] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const useVirtualRef = useRef(false);
  const virtualFixRef = useRef<{ lat: number; lng: number; accuracy: number } | null>(null);
  const virtualMarkerRef = useRef<any>(null);
  const mapClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);


  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<any[]>([]);
  const cpDragListenersRef = useRef<any[]>([]);

  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // Current location (display + recenter)
  const lastGeoRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastFixRef = useRef<{ lat: number; lng: number; accuracy: number; ts: number } | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);

  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const g = progress ?? await loadGame();
      if (!g) {
        show('ゲームデータがありません。ホームから新規開始してください。', 4500);
        nav('/');
        return;
      }
      setProgress(g);
      const s = await getJudgeTargetSpots();
      setSpots(s);
      const st = await getStationsByOrder();
      setStations(st);
    })();
  }, [nav, progress, setProgress, show]);

  const cooldownLeft = useMemo(() => {
    if (!progress?.cooldownUntilMs) return 0;
    return Math.max(0, Math.ceil((progress.cooldownUntilMs - nowMs) / 1000));
  }, [progress?.cooldownUntilMs, nowMs]);

  const upsertUserMarker = (map: google.maps.Map, pos: { lat: number; lng: number }) => {
    if (!userMarkerRef.current) {
      userMarkerRef.current = new google.maps.Marker({
        map,
        position: pos,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#2b7bff',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        clickable: false,
      });
      return;
    }
    userMarkerRef.current.setMap(map);
    userMarkerRef.current.setPosition(pos);
  };

  const startGeoWatch = (map: google.maps.Map) => {
    // clear previous watch if any
    if (geoWatchIdRef.current != null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(geoWatchIdRef.current); } catch { /* noop */ }
      geoWatchIdRef.current = null;
    }

    if (!navigator.geolocation) return;

    // watch current location for display + quick recenter
    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (useVirtualRef.current) return; // keep virtual location stable
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastGeoRef.current = p;
        lastFixRef.current = { ...p, accuracy: pos.coords.accuracy ?? 9999, ts: Date.now() };
        upsertUserMarker(map, p);
      },
      () => {
        // Don't spam toast; user will see on recenter / check-in.
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    );
  };

    useEffect(() => {
    (async () => {
      try {
        if (!mapEl.current) return;

        const p = progress;
        const center = p?.config.start ?? { lat: 31.2, lng: 130.5 };
        const mapId = (import.meta.env.VITE_GOOGLE_MAP_ID as string) || undefined;

        const map = await attachMap(mapEl.current, {
          center,
          zoom: 13,
          ...(mapId ? { mapId } : {}),
          gestureHandling: 'greedy', // 1本指で移動
        });
        mapRef.current = map;

        if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();

        startGeoWatch(map);
        if (DEBUG_TOOLS && useVirtualRef.current) ensureVirtualMarker(map);
      } catch (e: any) {
        show(e?.message ?? String(e), 6000);
      }
    })();

    return () => {
      // cleanup geo watch
      if (geoWatchIdRef.current != null && navigator.geolocation) {
        try { navigator.geolocation.clearWatch(geoWatchIdRef.current); } catch { /* noop */ }
        geoWatchIdRef.current = null;
      }
      // cleanup overlays because map is shared across routes
      try { userMarkerRef.current?.setMap(null); } catch { /* noop */ }
      userMarkerRef.current = null;

      try { clustererRef.current?.clearMarkers(); } catch { /* noop */ }
      clustererRef.current = null;

      for (const m of markersRef.current) {
        try { m.map = null; } catch { /* noop */ }
      }
      markersRef.current = [];

      try { infoWindowRef.current?.close(); } catch { /* noop */ }

      // Keep the single map instance alive across routes.
      disableVirtualMarker();
      parkMap();
    };
  }, [show, progress]);


  // render markers when map/spots/progress ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !progress) return;

    const AdvancedMarker = (google.maps as any).marker?.AdvancedMarkerElement;
    if (!AdvancedMarker) return;

    const iw = infoWindowRef.current ?? new google.maps.InfoWindow();
    infoWindowRef.current = iw;

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const openInfo = (anchor: any, html: string) => {
      iw.setContent(html);
      // InfoWindowはAdvancedMarker anchorでも開ける（環境差があるので例外を握る）
      try {
        iw.open({ map, anchor } as any);
      } catch {
        iw.open(map as any);
      }
    };

    // clear previous
    for (const l of cpDragListenersRef.current) { try { l?.remove?.(); } catch { /* noop */ } }
    cpDragListenersRef.current = [];
    for (const m of markersRef.current) { m.map = null; }
    markersRef.current = [];
    clustererRef.current?.clearMarkers();
    clustererRef.current = null;

    const cpSet = new Set(progress.cpSpotIds);
    const reachedCp = new Set(progress.reachedCpIds);
    const visited = new Set(progress.visitedSpotIds);

    // ----- marker UI helpers -----
    const sizeFill = (sizeClass?: string) => {
      switch ((sizeClass ?? '').toUpperCase()) {
        case 'S':  return '#ffffff'; // white
        case 'M':  return '#bfe6ff'; // light blue
        case 'L':  return '#bff2a8'; // yellow-green
        case 'XL': return '#fff3a6'; // yellow
        default:   return '#ffffff';
      }
    };

    const badgePxByScore = (score: number) => {
      if (score >= 200) return 36;
      if (score >= 120) return 32;
      if (score >= 60)  return 28;
      if (score >= 30)  return 26;
      return 24;
    };

    const mkCpBadge = (cpIndex: number, reached: boolean) => {
      const el = document.createElement('div');
      el.className = `cpBadge${reached ? ' reached' : ''}`;
      el.textContent = `★CP${cpIndex}`;
      return el;
    };

    const mkSpotBadge = (sp: Spot) => {
      const el = document.createElement('div');
      const px = badgePxByScore(sp.Score);

      el.className = `spotBadge${visited.has(sp.ID) ? ' visited' : ''}`;
      el.style.width = `${px}px`;
      el.style.height = `${px}px`;
      el.style.borderRadius = `${Math.round(px / 2)}px`;

      el.style.background = sizeFill(sp.size_class);
      el.textContent = String(sp.Score);
      el.title = `${sp.Name} / ${sp.Score}`;
      return el;
    };

    const mk = (label: string) => {
      const el = document.createElement('div');
      el.style.padding = '6px 8px';
      el.style.borderRadius = '10px';
      el.style.border = '1px solid rgba(0,0,0,.2)';
      el.style.background = 'rgba(255,255,255,.96)';
      el.style.fontSize = '12px';
      el.textContent = label;
      return el;
    };

    // Start/Goal markers
    const startM = new AdvancedMarker({ map, position: progress.config.start, content: mk('START') });
    const goalM  = new AdvancedMarker({ map, position: progress.config.goal,  content: mk('GOAL') });
    markersRef.current.push(startM, goalM);

    // CP markers (spot positions)
    const cpMarkers: any[] = [];
    for (let i = 0; i < progress.cpSpotIds.length; i++) {
      const id = progress.cpSpotIds[i];
      const sp = spots.find(s => s.ID === id);
      if (!sp) continue;

      const reached = reachedCp.has(id);
      const el = mkCpBadge(i + 1, reached);
      const m = new AdvancedMarker({
        map,
        position: { lat: sp.Latitude, lng: sp.Longitude },
        content: el,
      });

      const html =
        `<div style="font-size:13px;line-height:1.4">` +
        `<div style="font-weight:800;margin-bottom:4px">★CP${i + 1}</div>` +
        `<div>${esc(sp.Name)}</div>` +
        `<div style="margin-top:4px">Score: <b>${sp.Score}</b></div>` +
        (sp.Category ? `<div>Category: ${esc(sp.Category)}</div>` : '') +
        (sp.Description ? `<div style="margin-top:6px;opacity:.9">${esc(sp.Description)}</div>` : '') +
        `</div>`;

      const onClick = () => openInfo(m, html);
      try { m.addListener('gmp-click', onClick); } catch { /* noop */ }
      try { m.addListener('click', onClick); } catch { /* noop */ }


if (DEBUG_TOOLS) {
  try { (m as any).gmpDraggable = true; } catch { /* noop */ }

  const prevId = id;
  const prevPos = { lat: sp.Latitude, lng: sp.Longitude };

  const onDragEnd = () => {
    const p2 = normPos((m as any).position);
    if (!p2) return;

    // Snap to nearest judge spot to keep CPs stable/reproducible.
    let best: { sp: Spot; d: number } | null = null;
    for (const s of spots) {
      const d = haversineMeters(p2, { lat: s.Latitude, lng: s.Longitude });
      if (!best || d < best.d) best = { sp: s, d };
    }
    if (!best || best.d > 300) {
      // Too far from any spot: revert for now.
      try { (m as any).position = prevPos; } catch { /* noop */ }
      pushLog('CP_DRAG_REVERT', `★CP${i + 1} drag too far -> revert`, { lat: p2.lat, lng: p2.lng, nearestM: best ? Math.round(best.d) : null });
      show('近くにスポットがないためCPを移動できません（300m以内が必要）', 3500);
      return;
    }

    // Prevent duplicates across CPs.
    if (progress.cpSpotIds.some((x, idx) => idx !== i && x === best!.sp.ID)) {
      try { (m as any).position = prevPos; } catch { /* noop */ }
      pushLog('CP_DRAG_DUP', `★CP${i + 1} duplicate -> revert`, { targetId: best!.sp.ID, name: best!.sp.Name });
      show('そのスポットは既に別のCPに設定されています', 3500);
      return;
    }

    // Apply + snap
    const newIds = [...progress.cpSpotIds];
    newIds[i] = best!.sp.ID;
    const newP = { ...progress, cpSpotIds: newIds };

    try { (m as any).position = { lat: best!.sp.Latitude, lng: best!.sp.Longitude }; } catch { /* noop */ }

    applyProgressUpdate(newP, `★CP${i + 1} を移動しました`, 'CP_DRAG', {
      fromId: prevId,
      toId: best!.sp.ID,
      toName: best!.sp.Name,
      movedToDistM: Math.round(best!.d),
    });
  };

  try {
    const l1 = (m as any).addListener?.('gmp-dragend', onDragEnd);
    if (l1) cpDragListenersRef.current.push(l1);
  } catch { /* noop */ }

  try {
    const l2 = (m as any).addListener?.('dragend', onDragEnd);
    if (l2) cpDragListenersRef.current.push(l2);
  } catch { /* noop */ }
}

      cpMarkers.push(m);
    }
    markersRef.current.push(...cpMarkers);

    // Spot markers (cluster)
    const spotMarkers: any[] = spots
      .filter(sp => !cpSet.has(sp.ID)) // CPは専用マーカーなので重ねない
      .map(sp => {
        const m = new AdvancedMarker({
          position: { lat: sp.Latitude, lng: sp.Longitude },
          content: mkSpotBadge(sp),
        });

        const html =
          `<div style="font-size:13px;line-height:1.4">` +
          `<div style="font-weight:800;margin-bottom:4px">${esc(sp.Name)}</div>` +
          `<div>Score: <b>${sp.Score}</b></div>` +
          (sp.Category ? `<div>Category: ${esc(sp.Category)}</div>` : '') +
          (sp.Description ? `<div style="margin-top:6px;opacity:.9">${esc(sp.Description)}</div>` : '') +
          `</div>`;

        const onClick = () => openInfo(m, html);
        try { m.addListener('gmp-click', onClick); } catch { /* noop */ }
        try { m.addListener('click', onClick); } catch { /* noop */ }

        return m;
      });

    clustererRef.current = new MarkerClusterer({
      map,
      markers: spotMarkers,
      renderer: {
        render: ({ position }) => {
          return new google.maps.Marker({
            position,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#333',
              fillOpacity: 0.85,
              strokeColor: '#fff',
              strokeWeight: 2,
            },
            // label を出さない（件数非表示）
            label: undefined as any,
            zIndex: Number(google.maps.Marker.MAX_ZINDEX) + 1,
          });
        },
      } as any,
    });
  }, [spots, progress]);

  const doFix = async () => {
    // Prefer cached fix from watchPosition for snappy UI.
    const cached = lastFixRef.current;
    if (cached && Date.now() - cached.ts <= 10_000) {
      return { lat: cached.lat, lng: cached.lng, accuracy: cached.accuracy };
    if (useVirtualRef.current && virtualFixRef.current) {
      const v = virtualFixRef.current;
      // keep caches consistent
      lastGeoRef.current = { lat: v.lat, lng: v.lng };
      lastFixRef.current = { lat: v.lat, lng: v.lng, accuracy: v.accuracy, ts: Date.now() };
      return { lat: v.lat, lng: v.lng, accuracy: v.accuracy };
    }

    }

    try {
      const fix = await getCurrentFix(12000);
      // update cache for subsequent actions
      lastGeoRef.current = { lat: fix.lat, lng: fix.lng };
      lastFixRef.current = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, ts: Date.now() };
      return fix;
    } catch (e: any) {
      show('位置情報を取得できません。再試行してください。', 3500);
      return null;
    }
  const applyProgressUpdate = (p: any, msg: string, logType?: string, logData?: any) => {
    setProgress(p);
    show(msg, 3500);
    if (logType) pushLog(logType, msg, logData);
    void saveGame(p).catch(() => {
      // Avoid spamming users; keep it in console for now.
      // eslint-disable-next-line no-console
      console.warn('saveGame failed');
    });
  };

  const normPos = (pos: any): { lat: number; lng: number } | null => {
    if (!pos) return null;
    if (typeof pos.lat === 'function' && typeof pos.lng === 'function') return { lat: pos.lat(), lng: pos.lng() };
    if (typeof pos.lat === 'number' && typeof pos.lng === 'number') return { lat: pos.lat, lng: pos.lng };
    if (pos.latLng && typeof pos.latLng.lat === 'function') return { lat: pos.latLng.lat(), lng: pos.latLng.lng() };
    return null;
  };

  const setVirtualFix = (lat: number, lng: number, accuracy = 5, reason = 'manual') => {
    virtualFixRef.current = { lat, lng, accuracy };
    lastGeoRef.current = { lat, lng };
    lastFixRef.current = { lat, lng, accuracy, ts: Date.now() };
    const map = mapRef.current;
    if (map) upsertUserMarker(map, { lat, lng });

    const m = virtualMarkerRef.current;
    try {
      if (m) m.position = { lat, lng };
    } catch {
      try { m?.setPosition?.({ lat, lng }); } catch { /* noop */ }
    }
    pushLog('VLOC_SET', `virtual location set (${reason})`, { lat, lng, accuracy });
  };

  const ensureVirtualMarker = (map: google.maps.Map) => {
    if (!DEBUG_TOOLS || !useVirtualRef.current) return;

    const AdvancedMarker = (google.maps as any).marker?.AdvancedMarkerElement;
    if (!virtualFixRef.current) {
      const c = map.getCenter();
      const lat = c?.lat() ?? (lastFixRef.current?.lat ?? 31.2);
      const lng = c?.lng() ?? (lastFixRef.current?.lng ?? 130.5);
      virtualFixRef.current = { lat, lng, accuracy: 5 };
    }

    const v = virtualFixRef.current!;
    if (!virtualMarkerRef.current) {
      if (AdvancedMarker) {
        const el = document.createElement('div');
        el.style.padding = '4px 6px';
        el.style.borderRadius = '8px';
        el.style.border = '2px solid #ff2d55';
        el.style.background = 'rgba(255,255,255,.95)';
        el.style.fontWeight = '900';
        el.style.fontSize = '12px';
        el.textContent = 'VLOC';
        const m = new AdvancedMarker({ map, position: { lat: v.lat, lng: v.lng }, content: el });
        try { m.gmpDraggable = true; } catch { /* noop */ }

        const onEnd = () => {
          const p = normPos(m.position);
          if (!p) return;
          setVirtualFix(p.lat, p.lng, virtualFixRef.current?.accuracy ?? 5, 'drag');
        };
        try { (m as any).addListener?.('gmp-dragend', onEnd); } catch { /* noop */ }
        try { (m as any).addListener?.('dragend', onEnd); } catch { /* noop */ }

        virtualMarkerRef.current = m;
      } else {
        const m = new google.maps.Marker({ map, position: { lat: v.lat, lng: v.lng }, draggable: true, label: 'V' });
        m.addListener('dragend', () => {
          const p = m.getPosition();
          if (!p) return;
          setVirtualFix(p.lat(), p.lng(), virtualFixRef.current?.accuracy ?? 5, 'drag');
        });
        virtualMarkerRef.current = m;
      }
    } else {
      // ensure visible on this map
      try { virtualMarkerRef.current.map = map; } catch { /* noop */ }
      try { virtualMarkerRef.current.setMap?.(map); } catch { /* noop */ }
      try { virtualMarkerRef.current.position = { lat: v.lat, lng: v.lng }; } catch { /* noop */ }
      try { virtualMarkerRef.current.setPosition?.({ lat: v.lat, lng: v.lng }); } catch { /* noop */ }
    }

    // map click to place virtual location
    if (!mapClickListenerRef.current) {
      mapClickListenerRef.current = map.addListener('click', (e: any) => {
        if (!useVirtualRef.current) return;
        const ll = e?.latLng;
        if (!ll) return;
        setVirtualFix(ll.lat(), ll.lng(), virtualFixRef.current?.accuracy ?? 5, 'map-click');
      });
    }
  };

  const disableVirtualMarker = () => {
    // remove map click listener
    try { mapClickListenerRef.current?.remove(); } catch { /* noop */ }
    mapClickListenerRef.current = null;
    // hide marker (keep instance for quick re-enable)
    const m = virtualMarkerRef.current;
    try { m.map = null; } catch { /* noop */ }
    try { m.setMap?.(null); } catch { /* noop */ }
  };


  };

  const onPanToCurrent = async () => {
    const map = mapRef.current;
    if (!map) return;

    let pos = lastGeoRef.current;

    // watchPositionがまだ成功していない場合は、ここで1回だけ取得を試す
    if (!pos) {
      try {
        const fix = await getCurrentFix(8000);
        pos = { lat: fix.lat, lng: fix.lng };
        lastGeoRef.current = pos;
        upsertUserMarker(map, pos);
      } catch {
        show('現在地が取得できません。位置情報の許可/通信状態を確認してください。', 3500);
        return;
      }
    }

    map.panTo(pos);
    const z = map.getZoom() ?? 13;
    if (z < 15) map.setZoom(15);
  };


// ===== Debug helpers =====
const debugSetVirtualFromCurrent = async () => {
  const map = mapRef.current;
  if (!map) return;

  // Try to use current fix (real) even if virtual is enabled.
  try {
    const fix = await getCurrentFix(6000);
    setVirtualFix(fix.lat, fix.lng, Math.max(5, Math.round(fix.accuracy || 5)), 'from-current');
    show('DBG: 仮想現在地を現在地に設定しました', 2500);
  } catch {
    const c = map.getCenter();
    if (!c) return;
    setVirtualFix(c.lat(), c.lng(), 5, 'from-center');
    show('DBG: 仮想現在地を地図中心に設定しました', 2500);
  }
};

const debugShiftTimerMin = (deltaMin: number) => {
  if (!progress) return;
  const now = Date.now();
  let newStart = progress.startedAtMs + deltaMin * 60_000;
  // Avoid "future start" which breaks elapsed calc.
  if (newStart > now) newStart = now;
  const newP = { ...progress, startedAtMs: newStart };
  applyProgressUpdate(newP, `DBG: タイマー調整 ${deltaMin >= 0 ? '+' : ''}${deltaMin}分`, 'TIMER_SHIFT', { deltaMin });
};

const debugSetRemainingMin = (remainMin: number) => {
  if (!progress) return;
  const now = Date.now();
  const durationSec = Math.max(0, Math.round((progress.config?.durationMin ?? 0) * 60));
  const remainSec = Math.max(0, Math.min(durationSec, Math.round(remainMin * 60)));
  const elapsedTargetSec = Math.max(0, durationSec - remainSec);
  let newStart = now - elapsedTargetSec * 1000;
  // Clamp to [now - duration, now]
  const minStart = now - durationSec * 1000;
  if (newStart < minStart) newStart = minStart;
  if (newStart > now) newStart = now;

  const newP = { ...progress, startedAtMs: newStart };
  applyProgressUpdate(newP, `DBG: 残り時間を${remainMin}分に設定`, 'TIMER_SET', { remainMin });
};

  // (moved) progress update helper is applyProgressUpdate

  const onCheckIn = async () => {
  if (checkInBusy) return;
  if (!online) return show('オフライン/圏外のためチェックインできません。オンラインで再試行してください。', 4500);
  if (!progress) return;

  setCheckInBusy(true);
  // Let React paint the "busy" state before doing any async work.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  try {
    const fix = await doFix();
    if (!fix) return;

    const loc = { lat: fix.lat, lng: fix.lng };

    let candidateTop: any[] | undefined;
    let chosenCandidate: any | undefined;

    if (DEBUG_TOOLS) {
      const cands = spots
        .map(s => ({ s, d: haversineMeters(loc, { lat: s.Latitude, lng: s.Longitude }) }))
        .filter(x => x.d <= CHECKIN_RADIUS_M)
        .sort((a, b) => (a.d - b.d) || (b.s.Score - a.s.Score) || a.s.ID.localeCompare(b.s.ID));

      candidateTop = cands.slice(0, 3).map(x => ({
        id: x.s.ID,
        name: x.s.Name,
        score: x.s.Score,
        distM: Math.round(x.d),
      }));

      if (cands[0]) {
        chosenCandidate = {
          id: cands[0].s.ID,
          name: cands[0].s.Name,
          score: cands[0].s.Score,
          distM: Math.round(cands[0].d),
          isCp: progress.cpSpotIds.includes(cands[0].s.ID),
        };
      }

      pushLog('CHECKIN_ATTEMPT', 'spot/cp check-in', {
        loc,
        accuracy: fix.accuracy,
        radiusM: CHECKIN_RADIUS_M,
        candidateTop,
      });
    }

    const before = progress;
    const r = checkInSpotOrCp(progress, loc, fix.accuracy, spots);

    if (!r.ok) {
      const cdLeft = before.cooldownUntilMs ? Math.max(0, Math.ceil((before.cooldownUntilMs - Date.now()) / 1000)) : 0;
      pushLog('CHECKIN_FAIL', r.message, {
        code: r.code,
        loc,
        accuracy: fix.accuracy,
        radiusM: CHECKIN_RADIUS_M,
        maxAccuracyM: MAX_ACCURACY_M,
        candidateTop,
        chosenCandidate,
        cooldownLeftSec: cdLeft,
      });
      show(r.message, 4500);
      return;
    }

    const after = r.progress as any;
    pushLog('CHECKIN_OK', r.message, {
      kind: (r as any).kind,
      loc,
      accuracy: fix.accuracy,
      radiusM: CHECKIN_RADIUS_M,
      chosenCandidate,
      scoreDelta: (after.score ?? 0) - (before.score ?? 0),
      penaltyDelta: (after.penalty ?? 0) - (before.penalty ?? 0),
      newScore: after.score,
      newPenalty: after.penalty,
      cooldownLeftSec: after.cooldownUntilMs ? Math.max(0, Math.ceil((after.cooldownUntilMs - Date.now()) / 1000)) : 0,
    });

    applyProgressUpdate(r.progress, r.message);
  } finally {
    setCheckInBusy(false);
  }
};

  const onJrBoard = async () => {
  if (checkInBusy) return;
  if (!online) return show('オフライン/圏外のためチェックインできません。', 4500);
  if (!progress) return;

  setCheckInBusy(true);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  try {
    const fix = await doFix();
    if (!fix) return;

    const loc = { lat: fix.lat, lng: fix.lng };

    let candTop: any[] | undefined;
    let chosen: any | undefined;
    if (DEBUG_TOOLS) {
      const cands = stations
        .map(st => ({ st, d: haversineMeters(loc, { lat: st.lat, lng: st.lng }) }))
        .filter(x => x.d <= CHECKIN_RADIUS_M)
        .sort((a, b) => (a.d - b.d) || a.st.stationId.localeCompare(b.st.stationId));

      candTop = cands.slice(0, 3).map(x => ({
        stationId: x.st.stationId,
        name: x.st.name,
        distM: Math.round(x.d),
      }));
      if (cands[0]) chosen = { stationId: cands[0].st.stationId, name: cands[0].st.name, distM: Math.round(cands[0].d) };

      pushLog('JR_BOARD_ATTEMPT', 'JR 乗車チェックイン', {
        loc,
        accuracy: fix.accuracy,
        radiusM: CHECKIN_RADIUS_M,
        candidateTop: candTop,
        cooldownSec: JR_COOLDOWN_SEC,
      });
    }

    const before = progress;
    const r = jrBoard(progress, loc, fix.accuracy, stations);

    if (!r.ok) {
      const cdLeft = before.cooldownUntilMs ? Math.max(0, Math.ceil((before.cooldownUntilMs - Date.now()) / 1000)) : 0;
      pushLog('JR_BOARD_FAIL', r.message, { code: r.code, chosen, candidateTop: candTop, cooldownLeftSec: cdLeft });
      show(r.message, 4500);
      return;
    }

    const after = r.progress as any;
    pushLog('JR_BOARD_OK', r.message, {
      chosen,
      scoreDelta: (after.score ?? 0) - (before.score ?? 0),
      penaltyDelta: (after.penalty ?? 0) - (before.penalty ?? 0),
      cooldownLeftSec: after.cooldownUntilMs ? Math.max(0, Math.ceil((after.cooldownUntilMs - Date.now()) / 1000)) : 0,
    });

    applyProgressUpdate(r.progress, r.message);
  } finally {
    setCheckInBusy(false);
  }
};

  const onJrAlight = async () => {
  if (checkInBusy) return;
  if (!online) return show('オフライン/圏外のためチェックインできません。', 4500);
  if (!progress) return;

  setCheckInBusy(true);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  try {
    const fix = await doFix();
    if (!fix) return;

    const loc = { lat: fix.lat, lng: fix.lng };

    let candTop: any[] | undefined;
    let chosen: any | undefined;
    if (DEBUG_TOOLS) {
      const cands = stations
        .map(st => ({ st, d: haversineMeters(loc, { lat: st.lat, lng: st.lng }) }))
        .filter(x => x.d <= CHECKIN_RADIUS_M)
        .sort((a, b) => (a.d - b.d) || a.st.stationId.localeCompare(b.st.stationId));

      candTop = cands.slice(0, 3).map(x => ({
        stationId: x.st.stationId,
        name: x.st.name,
        distM: Math.round(x.d),
      }));
      if (cands[0]) chosen = { stationId: cands[0].st.stationId, name: cands[0].st.name, distM: Math.round(cands[0].d) };

      pushLog('JR_ALIGHT_ATTEMPT', 'JR 降車チェックイン', {
        loc,
        accuracy: fix.accuracy,
        radiusM: CHECKIN_RADIUS_M,
        candidateTop: candTop,
        cooldownSec: JR_COOLDOWN_SEC,
      });
    }

    const before = progress;
    const r = jrAlight(progress, loc, fix.accuracy, stations);

    if (!r.ok) {
      const cdLeft = before.cooldownUntilMs ? Math.max(0, Math.ceil((before.cooldownUntilMs - Date.now()) / 1000)) : 0;
      pushLog('JR_ALIGHT_FAIL', r.message, { code: r.code, chosen, candidateTop: candTop, cooldownLeftSec: cdLeft });
      show(r.message, 4500);
      return;
    }

    const after = r.progress as any;
    pushLog('JR_ALIGHT_OK', r.message, {
      chosen,
      scoreDelta: (after.score ?? 0) - (before.score ?? 0),
      penaltyDelta: (after.penalty ?? 0) - (before.penalty ?? 0),
      cooldownLeftSec: after.cooldownUntilMs ? Math.max(0, Math.ceil((after.cooldownUntilMs - Date.now()) / 1000)) : 0,
    });

    applyProgressUpdate(r.progress, r.message);
  } finally {
    setCheckInBusy(false);
  }
};

  const onGoal = async () => {
  if (checkInBusy) return;
  if (!online) return show('オフライン/圏外のためチェックインできません。', 4500);
  if (!progress) return;

  setCheckInBusy(true);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  try {
    const fix = await doFix();
    if (!fix) return;

    const loc = { lat: fix.lat, lng: fix.lng };

    const before = progress;
    const r = goalCheckIn(progress, loc, fix.accuracy);

    if (!r.ok) {
      pushLog('GOAL_FAIL', r.message, { code: r.code, loc, accuracy: fix.accuracy, radiusM: CHECKIN_RADIUS_M });
      show(r.message, 4500);
      return;
    }

    const after = r.progress as any;
    pushLog('GOAL_OK', r.message, {
      loc,
      accuracy: fix.accuracy,
      radiusM: CHECKIN_RADIUS_M,
      scoreDelta: (after.score ?? 0) - (before.score ?? 0),
      penaltyDelta: (after.penalty ?? 0) - (before.penalty ?? 0),
      finalScore: after.score,
      finalPenalty: after.penalty,
    });

    setProgress(r.progress);
    await saveGame(r.progress);
    nav('/result');
  } finally {
    setCheckInBusy(false);
  }
};

  const rem = progress ? remainingSec(nowMs) : 0;
  const mm = Math.floor(rem / 60);
  const ss = rem % 60;

  return (
    <>
      <div className="card">
        <h3>プレイ</h3>
        {!online && <div className="banner">オフライン/圏外のためチェックインできません。</div>}
        <div className="hint">
          CP達成：{progress ? progress.reachedCpIds.length : 0}/{progress ? progress.cpSpotIds.length : 0}
        </div>
        {progress?.config.jrEnabled && (
          <div className="hint">JRクールダウン：{cooldownLeft > 0 ? `${cooldownLeft}秒` : 'なし'}</div>
        )}
      </div>

      <div style={{ height: 12 }} />
      <div className="card" style={{ position: 'relative' }}>
        <div className="mapWrap" ref={mapEl} />

        {/* 上段中央：残り時間（左）＋得点（右） */}
        <div
          className="overlay"
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 10,
            zIndex: 6,
            pointerEvents: 'none',
          }}
        >
          <div className="pill">残り {mm}:{String(ss).padStart(2, '0')}</div>
          <div className="pill">得点 {progress?.score ?? 0}</div>
        </div>

        {/* 下段中央：現在地ボタン */}
        <button
          className="btn"
          onClick={onPanToCurrent}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 12,
            transform: 'translateX(-50%)',
            zIndex: 6,
          }}
        >
          現在地
        </button>
      </div>

      <div style={{ height: 12 }} />
      <div className="card">
        <h3>チェックイン</h3>
        <div className="actions">
          <button className="btn primary" onClick={onCheckIn} disabled={checkInBusy}>
            {checkInBusy ? 'チェックイン中…' : 'スポット/CP チェックイン'}
          </button>
          {progress?.config.jrEnabled && (
            <>
              <button className="btn" onClick={onJrBoard} disabled={checkInBusy || cooldownLeft > 0}>乗車チェックイン</button>
              <button className="btn" onClick={onJrAlight} disabled={checkInBusy || cooldownLeft > 0}>降車チェックイン</button>
            </>
          )}
          <button className="btn" onClick={onGoal} disabled={checkInBusy}>ゴールチェックイン</button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          ・到着判定：50m以内／accuracy≦100m／複数候補時（案A）：最近傍→同率ならScore高→それでも同率ならID昇順
        </div>
        {progress?.config.jrEnabled && (
          <div className="hint">
            ・JR：成功後60秒は無反応（ボタンはグレーダウン）／同一駅での乗車・降車は禁止（ゲーム全体で同一駅の乗降再利用も不可）
          </div>
        )}
      </div>
      {Toast}
    </>
  );
}
