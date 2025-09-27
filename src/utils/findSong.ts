import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import { Song } from '../types'; // Adjust path if needed

const SONGS_DIR = path.resolve(__dirname, '../songs'); // Assumes 'songs' is one level above src/dist

// Ensure songs directory exists (run once at module load)
if (!fs.existsSync(SONGS_DIR)) {
  console.error(`Error: Songs directory not found at ${SONGS_DIR}`);
  // Consider exiting or handling this more gracefully depending on requirements
}

let songCache: Song[] = [];
let fuse: Fuse<Song> | null = null;

function loadSongs(): void {
  console.log(`Loading songs from: ${SONGS_DIR}`);
  try {
    const files = fs.readdirSync(SONGS_DIR).filter(
      (file) => /\.(mp3|ogg|wav|flac|m4a|aac)$/i.test(file), // Filter for audio files
    );
    songCache = files.map((file) => ({
      name: file,
      path: path.join(SONGS_DIR, file),
    }));

    // Initialize Fuse.js for fuzzy searching
    fuse = new Fuse(songCache, {
      keys: ['name'], // Search by song name
      includeScore: true,
      threshold: 0.4, // Adjust threshold (0=exact match, 1=match anything)
    });
    console.log(`Loaded ${songCache.length} songs.`);
  } catch (error) {
    console.error('Error loading songs directory:', error);
    songCache = [];
    fuse = null;
  }
}

// Initial load
loadSongs();

// Function to find the best song match
export function findSong(query: string): Song | null {
  if (!fuse) {
    console.error('Fuse.js index not initialized.');
    return null; // Or fallback to simple includes if preferred
  }

  const results = fuse.search(query);

  if (results.length > 0) {
    // Fuse returns results sorted by score (lower is better)
    console.log(
      `Query "${query}" matched "${results[0].item.name}" with score ${results[0].score}`,
    );
    return results[0].item;
  }

  return null;
}

// Function to get all loaded song names
export function getAllSongNames(): string[] {
  return songCache.map((song) => song.name);
}

// Optional: Add a function to reload songs if needed (e.g., via a command)
export function reloadSongs(): void {
  loadSongs();
}
