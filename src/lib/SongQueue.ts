import type { Song } from '../types';

export class SongQueue {
  private items: Song[] = [];

  enqueue(song: Song): string {
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
