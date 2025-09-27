import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import type { Song } from '../types';

const AUDIO_RE = /\.(mp3|ogg|wav|flac|m4a|aac)$/i;

function candidateDirs(): string[] {
  // Prefer root 'songs/' but also support legacy 'src/songs/'
  const dirs = [
    path.resolve(process.cwd(), 'songs'),
    path.resolve(__dirname, '../songs'),
  ];
  // Deduplicate
  return Array.from(new Set(dirs));
}

let songCache: Song[] = [];
let fuse: Fuse<Song> | null = null;

function loadSongs(): void {
  const dirs = candidateDirs().filter((p) => fs.existsSync(p));
  if (dirs.length === 0) {
    console.error('Error: No songs directory found. Create ./songs or src/songs');
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
    console.log(`Loaded ${songCache.length} songs from: ${dirs.join(', ')}`);
  } catch (error) {
    console.error('Error loading songs:', error);
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
  const results = fuse.search(q);
  if (results.length > 0) {
    console.log(`Query "${query}" matched "${results[0].item.name}"`);
    return results[0].item;
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
