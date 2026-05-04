import { openDB, type DBSchema } from 'idb';

interface QuickCutDB extends DBSchema {
  videos: {
    key: string;
    value: {
      id: string;
      name: string;
      blob: Blob;
      duration: number;
      createdAt: number;
      size: number;
    };
    indexes: { 'by-date': number };
  };
}

const DB_NAME = 'quick-cut-db';
const STORE_NAME = 'videos';

export async function getDB() {
  return openDB<QuickCutDB>(DB_NAME, 1, {
    upgrade(db) {
      const store = db.createObjectStore(STORE_NAME, {
        keyPath: 'id',
      });
      store.createIndex('by-date', 'createdAt');
    },
  });
}

export async function saveVideo(video: { id: string; name: string; blob: Blob; duration: number; size: number }) {
  const db = await getDB();
  await db.put(STORE_NAME, {
    ...video,
    createdAt: Date.now(),
  });
}

export async function getAllVideos() {
  const db = await getDB();
  const videos = await db.getAllFromIndex(STORE_NAME, 'by-date');
  return videos.reverse();
}

export async function deleteVideo(id: string) {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}
