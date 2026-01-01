import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Spot, Station, GameProgress } from '../types';

interface IbumakuDB extends DBSchema {
  spot_master: {
    key: string; // Spot.ID
    value: Spot;
    indexes: { 'by_judge': number };
  };
  station_master: {
    key: string; // stationId
    value: Station;
    indexes: { 'by_order': number };
  };
  game_state: {
    key: string; // 'current'
    value: GameProgress;
  };
}

let _db: Promise<IDBPDatabase<IbumakuDB>> | null = null;

export function getDB() {
  if (!_db) {
    _db = openDB<IbumakuDB>('ibumaku_support_app', 1, {
      upgrade(db) {
        const spot = db.createObjectStore('spot_master', { keyPath: 'ID' });
        spot.createIndex('by_judge', 'JudgeTarget');
        const station = db.createObjectStore('station_master', { keyPath: 'stationId' });
        station.createIndex('by_order', 'orderIndex');
        db.createObjectStore('game_state');
      },
    });
  }
  return _db;
}
