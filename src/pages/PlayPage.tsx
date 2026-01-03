import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { attachMap, parkMap } from '../map/mapSingleton';
import { getJudgeTargetSpots, getStationsByOrder, loadGame, saveGame } from '../db/repo';
import type { Spot, Station } from '../types';
import { useGameStore } from '../store/gameStore';
import { useToast } from '../hooks/useToast';
import { useOnline } from '../hooks/useOnline';
import { getCurrentFix } from '../logic/location';
import { checkInSpotOrCp, goalCheckIn, jrAlight, jrBoard } from '../logic/game';
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

  // ---- persistent visited marker (⭐️) ----
  // 端末内のみ保持（端末変更で消失を許容）。ゲームを跨いで「一度でも訪れたことがある」スポットを記録する。
  const EVER_VISITED_SPOT_KEY = 'ibumaku_everVisitedSpotIds_v1';
  const everVisitedSpotIdsRef = useRef<Set<string>>(new Set());

  const loadEverVisitedSpots = () => {
    try {
      const raw = localStorage.getItem(EVER_VISITED_SPOT_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        everVisitedSpotIdsRef.current = new Set(arr.map((v) => String(v)));
      }
    } catch {
      // noop
    }
  };

  const persistEverVisitedSpots = () => {
    try {
      const arr = Array.from(everVisitedSpotIdsRef.current.values());
      localStorage.setItem(EVER_VISITED_SPOT_KEY, JSON.stringify(arr));
    } catch {
      // noop
    }
  };

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<any[]>([]);
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
    loadEverVisitedSpots();
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
    for (const m of markersRef.current) { m.map = null; }
    markersRef.current = [];
    clustererRef.current?.clearMarkers();
    clustererRef.current = null;

    const cpSet = new Set(progress.cpSpotIds);
    const reachedCp = new Set(progress.reachedCpIds);
    const visited = new Set(progress.visitedSpotIds);
    const everVisited = everVisitedSpotIdsRef.current;

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
      const px = badgePxByScore(sp.Score);
      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      wrap.style.width = `${px}px`;
      wrap.style.height = `${px}px`;

      // そのゲーム中にチェックインしたスポットは 🚩 表示（次回ゲームでは progress.visitedSpotIds がリセットされるので元に戻る）
      if (visited.has(sp.ID)) {
        const el = document.createElement('div');
        el.className = 'spotFlag';
        el.style.width = `${px}px`;
        el.style.height = `${px}px`;
        el.style.borderRadius = `${Math.round(px / 2)}px`;
        el.style.background = sizeFill(sp.size_class);
        el.style.border = '2px solid #ff2d55';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.fontSize = `${Math.max(14, Math.round(px * 0.6))}px`;
        el.textContent = '🚩';
        el.title = `${sp.Name} / ${sp.Score}`;
        wrap.appendChild(el);
        return wrap;
      }

      // 未訪問（このゲーム内）スポットはスコアバッジ。過去に一度でも訪問済みなら右上に ⭐️ を付与。
      const el = document.createElement('div');
      el.className = 'spotBadge';
      el.style.width = `${px}px`;
      el.style.height = `${px}px`;
      el.style.borderRadius = `${Math.round(px / 2)}px`;
      el.style.background = sizeFill(sp.size_class);
      el.textContent = String(sp.Score);
      el.title = `${sp.Name} / ${sp.Score}`;
      wrap.appendChild(el);

      if (everVisited.has(sp.ID)) {
        const star = document.createElement('div');
        star.textContent = '⭐️';
        star.style.position = 'absolute';
        star.style.right = '-8px';
        star.style.top = '-10px';
        star.style.fontSize = '12px';
        star.style.lineHeight = '12px';
        star.style.pointerEvents = 'none';
        wrap.appendChild(star);
      }
      return wrap;
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
        render: ({ position }: { position: google.maps.LatLngLiteral }) => {
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

  const doUpdateProgress = (p: any, msg: string) => {
    // UI first, persistence second (IDB write can be slow on mobile).
    setProgress(p);
    show(msg, 3500);
    void saveGame(p).catch(() => {
      // Avoid spamming users; keep it in console for now.
      console.warn('saveGame failed');
    });
  };

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

      const prevVisited = new Set(progress.visitedSpotIds);
      const r = checkInSpotOrCp(progress, { lat: fix.lat, lng: fix.lng }, fix.accuracy, spots);
      if (!r.ok) {
        show(r.message, 4500);
        return;
      }
      // Persist "ever visited" spot ids (⭐️ marker)
      try {
        const nextVisited = new Set(r.progress.visitedSpotIds);
        let changed = false;
        for (const id of nextVisited) {
          if (!prevVisited.has(id)) {
            if (!everVisitedSpotIdsRef.current.has(id)) {
              everVisitedSpotIdsRef.current.add(id);
              changed = true;
            }
          }
        }
        if (changed) persistEverVisitedSpots();
      } catch { /* noop */ }

      doUpdateProgress(r.progress, r.message);
    } finally {
      setCheckInBusy(false);
    }
  };

  const onJrBoard = async () => {
    if (!online) return show('オフライン/圏外のためチェックインできません。', 4500);
    if (!progress) return;
    const fix = await doFix();
    if (!fix) return;
    const r = jrBoard(progress, { lat: fix.lat, lng: fix.lng }, fix.accuracy, stations);
    if (!r.ok) return show(r.message, 4500);
    doUpdateProgress(r.progress, r.message);
  };

  const onJrAlight = async () => {
    if (!online) return show('オフライン/圏外のためチェックインできません。', 4500);
    if (!progress) return;
    const fix = await doFix();
    if (!fix) return;
    const r = jrAlight(progress, { lat: fix.lat, lng: fix.lng }, fix.accuracy, stations);
    if (!r.ok) return show(r.message, 4500);
    doUpdateProgress(r.progress, r.message);
  };

  const onGoal = async () => {
    if (!online) return show('オフライン/圏外のためチェックインできません。', 4500);
    if (!progress) return;
    const fix = await doFix();
    if (!fix) return;
    const r = goalCheckIn(progress, { lat: fix.lat, lng: fix.lng }, fix.accuracy);
    if (!r.ok) return show(r.message, 4500);
    await saveGame(r.progress);
    setProgress(r.progress);
    show(r.message, 2000);
    nav('/result');
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
