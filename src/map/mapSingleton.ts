import { loadGoogleMaps } from './loadGoogleMaps';

/**
 * Singleton Google Map instance shared across pages to reduce "map load" count.
 * - Creates the map only on first attach (lazy).
 * - Moves the underlying map <div> between page containers.
 * - Parks the map <div> into a hidden container on unmount so it survives route changes.
 */
let mapDiv: HTMLDivElement | null = null;
let map: google.maps.Map | null = null;
let parkingDiv: HTMLDivElement | null = null;

function ensureParkingDiv(): HTMLDivElement {
  if (parkingDiv) return parkingDiv;
  const id = 'gmap-parking';
  const existing = document.getElementById(id) as HTMLDivElement | null;
  if (existing) {
    parkingDiv = existing;
    return existing;
  }
  const d = document.createElement('div');
  d.id = id;
  d.style.display = 'none';
  document.body.appendChild(d);
  parkingDiv = d;
  return d;
}

function ensureMapDiv(): HTMLDivElement {
  if (mapDiv) return mapDiv;
  const d = document.createElement('div');
  d.style.width = '100%';
  d.style.height = '100%';
  d.style.touchAction = 'none'; // help with touch/gesture handling
  mapDiv = d;
  return d;
}

export async function attachMap(host: HTMLElement, opts: google.maps.MapOptions): Promise<google.maps.Map> {
  await loadGoogleMaps();

  const div = ensureMapDiv();
  // Move the same div under the new host (preserves WebGL/canvas state better than recreating)
  if (div.parentElement !== host) {
    host.innerHTML = '';
    host.appendChild(div);
  }

  if (!map) {
    map = new google.maps.Map(div, opts);
  } else {
    map.setOptions(opts);
    // If host changed, force resize-ish by triggering center set (Maps JS often handles automatically)
    if (opts.center) map.setCenter(opts.center);
    if (typeof opts.zoom === 'number') map.setZoom(opts.zoom);
  }
  return map;
}

export function parkMap(): void {
  const div = mapDiv;
  if (!div) return;
  const parking = ensureParkingDiv();
  if (div.parentElement !== parking) {
    parking.appendChild(div);
  }
}

export function getMap(): google.maps.Map | null {
  return map;
}
