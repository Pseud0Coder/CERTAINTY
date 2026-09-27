/* Type surface for ../livekit-client.esm.mjs, hand-written to cover only the
   API the candidate app uses. The real library ships full declarations that
   reference its whole source tree; this file exists so tsc can type the
   single-file import without vendoring the tree. */

export interface RemoteTrack {
  kind: string;
  attach(element: HTMLMediaElement): void;
}

export interface LocalTrack {
  kind: string;
}

export declare class Room {
  connect(url: string, token: string): Promise<void>;
  disconnect(): void;
  localParticipant: {
    publishTrack(track: LocalTrack): Promise<unknown>;
  };
  on(
    event: string,
    listener: (track: RemoteTrack, publication: unknown, participant: unknown) => void,
  ): void;
}

export declare const RoomEvent: {
  readonly TrackSubscribed: 'trackSubscribed';
};

export declare function createLocalAudioTrack(
  options?: Record<string, unknown>,
): Promise<LocalTrack>;
