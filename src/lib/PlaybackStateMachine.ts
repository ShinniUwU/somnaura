export type PlaybackState = 'IDLE' | 'JOINING' | 'READY' | 'PLAYING' | 'STOPPING' | 'DESTROYED';

const VALID_TRANSITIONS: Record<PlaybackState, PlaybackState[]> = {
  IDLE: ['JOINING', 'DESTROYED'],
  JOINING: ['READY', 'DESTROYED'],
  READY: ['PLAYING', 'STOPPING', 'DESTROYED'],
  PLAYING: ['STOPPING', 'READY', 'DESTROYED'],
  STOPPING: ['READY', 'DESTROYED', 'IDLE'],
  DESTROYED: [],
};

export class PlaybackStateMachine {
  private state: PlaybackState = 'IDLE';

  getState(): PlaybackState {
    return this.state;
  }

  canTransition(next: PlaybackState): boolean {
    return VALID_TRANSITIONS[this.state].includes(next);
  }

  transition(next: PlaybackState): PlaybackState {
    if (!this.canTransition(next)) {
      throw new Error(`Invalid state transition from ${this.state} to ${next}`);
    }
    this.state = next;
    return this.state;
  }
}
