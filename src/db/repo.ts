import type { Spot, Station, GameProgress } from '../types';
import { getDB } from './db';

export async function putSpots(spots: Spot[]) {
  const db = await getDB();
  const tx = db.transaction('spot_master', 'readwrite');
  await tx.store.clear();
  for (const s of spots) await tx.store.put(s);
  await tx.done;
}

export async function getAllSpots(): Promise<Spot[]> {
  const db = await getDB();
  return await db.getAll('spot_master');
}

export async function getJudgeTargetSpots(): Promise<Spot[]> {
  const db = await getDB();
  // index query
  return await db.getAllFromIndex('spot_master', 'by_judge', 1);
}

export async function putStations(stations: Station[]) {
  const db = await getDB();
  const tx = db.transaction('station_master', 'readwrite');
  await tx.store.clear();
  for (const s of stations) await tx.store.put(s);
  await tx.done;
}

export async function getAllStations(): Promise<Station[]> {
  const db = await getDB();
  return await db.getAll('station_master');
}

export async function getStationsByOrder(): Promise<Station[]> {
  const db = await getDB();
  return await db.getAllFromIndex('station_master', 'by_order');
}

export async function saveGame(progress: GameProgress) {
  const db = await getDB();
  await db.put('game_state', progress, 'current');
}

export async function loadGame(): Promise<GameProgress | undefined> {
  const db = await getDB();
  return await db.get('game_state', 'current');
}

export async function clearGame() {
  const db = await getDB();
  await db.delete('game_state', 'current');
}
