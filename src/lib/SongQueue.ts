import type { Song } from '../types';

const MAX_QUEUE_SIZE = 50;

export class SongQueue {
  private items: Song[] = [];

  enqueue(song: Song): string {
    if (this.items.length >= MAX_QUEUE_SIZE) {
      return `Queue is full (max ${MAX_QUEUE_SIZE} songs). Use /queue clear to make room.`;
    }
    this.items.push(song);
    return `Queued: ${song.name} (${this.items.length} in queue)`;
  }

  dequeue(): Song | undefined {
    return this.items.shift();
  }

  list(): Song[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  size(): number {
    return this.items.length;
  }
}
