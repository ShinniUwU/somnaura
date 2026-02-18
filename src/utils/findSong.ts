import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import Fuse from 'fuse.js';
import type { Song } from '../types';
import { logger } from './logger';

const AUDIO_RE = /\.(mp3|ogg|wav|flac|m4a|aac|opus)$/i;

function candidateDirs(): string[] {
  // Prefer root 'songs/' but also support legacy 'src/songs/'
  const cwdSongs = path.resolve(process.cwd(), 'songs');
  // Resolve based on the current module URL (ESM-safe); falls back to cwd if something goes wrong
  let moduleSongs = cwdSongs;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    moduleSongs = path.resolve(here, '../songs');
  } catch {}
  const dirs = [cwdSongs, moduleSongs];
  // Deduplicate
  return Array.from(new Set(dirs));
}

let songCache: Song[] = [];
let fuse: Fuse<Song> | null = null;

function loadSongs(): void {
  const dirs = candidateDirs().filter((p) => fs.existsSync(p));
  if (dirs.length === 0) {
    logger.error('No songs directory found. Create ./songs or src/songs', { scope: 'songs', event: 'no_songs_dir' });
  }

  try {
    const entries: Song[] = [];
    for (const dir of dirs) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => AUDIO_RE.test(f));
      for (const file of files) {
        const full = path.join(dir, file);
        // Normalize display name: trim whitespace and drop extension for matching
        const base = path.parse(file).name.trim();
        const display = base || file.trim();
        // Prefer first occurrence of a given name (root songs/ has priority by order)
        if (!entries.some((e) => e.name === display)) {
          entries.push({ name: display, path: full });
        }
      }
    }
    songCache = entries;

    fuse = new Fuse(songCache, {
      keys: ['name'],
      includeScore: true,
      threshold: 0.4,
    });
    logger.info(`Loaded ${songCache.length} songs`, { scope: 'songs', event: 'songs_loaded' }, { dirs });
  } catch (error) {
    logger.error('Error loading songs', { scope: 'songs', event: 'load_error' }, error);
    songCache = [];
    fuse = null;
  }
}

// Initial load
loadSongs();

export function findSong(query: string): Song | null {
  if (!fuse) return null;
  const q = query.trim();
  const normalized = q.toLowerCase();
  const direct = songCache.find((s) => s.name.toLowerCase() === normalized);
  if (direct) return direct;
  const partial = songCache.find((s) => s.name.toLowerCase().includes(normalized));
  if (partial) return partial;
  try {
    const results = fuse.search(q);
    if (results.length > 0) {
      logger.debug(`Fuzzy matched query`, { scope: 'songs', event: 'fuzzy_match' }, { query, matched: results[0].item.name });
      return results[0].item;
    }
  } catch (e) {
    logger.warn(`Fuzzy search failed for query`, { scope: 'songs', event: 'fuzzy_error' }, { query, error: (e as Error).message });
  }
  return null;
}

export function getAllSongNames(): string[] {
  return songCache.map((song) => song.name);
}

export function reloadSongs(): void {
  loadSongs();
}

export function hasAnySongs(): boolean {
  return songCache.length > 0;
}
