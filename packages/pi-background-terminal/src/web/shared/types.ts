import type { PTYSessionInfo, SpawnOptions } from "../../pty/types.js";

export interface SerializedError {
  name: string;
  message: string;
}

export type CreateSessionRequestBody = Omit<SpawnOptions, "parentSessionId">;
export interface InputRequestBody {
  data: string;
}

export interface SessionRawBufferResponse {
  raw: string;
  byteLength: number;
}

export interface SessionPlainBufferResponse {
  plain: string;
  byteLength: number;
}

export interface WSMessageClientSubscribeSession {
  type: "subscribe";
  sessionId: string;
}

export interface WSMessageClientUnsubscribeSession {
  type: "unsubscribe";
  sessionId: string;
}

export interface WSMessageClientSessionList {
  type: "session_list";
}

export interface WSMessageClientSpawnSession extends CreateSessionRequestBody {
  type: "spawn";
  subscribe?: boolean;
}

export interface WSMessageClientInput {
  type: "input";
  sessionId: string;
  data: string;
}

export interface WSMessageClientReadRaw {
  type: "readRaw";
  sessionId: string;
}

export type WSMessageClient =
  | WSMessageClientSubscribeSession
  | WSMessageClientUnsubscribeSession
  | WSMessageClientSessionList
  | WSMessageClientSpawnSession
  | WSMessageClientInput
  | WSMessageClientReadRaw;

export interface WSMessageServerSessionList {
  type: "session_list";
  sessions: PTYSessionInfo[];
}

export interface WSMessageServerSessionUpdate {
  type: "session_update";
  session: PTYSessionInfo;
}

export interface WSMessageServerRawData {
  type: "raw_data";
  session: PTYSessionInfo;
  rawData: string;
}

export interface WSMessageServerReadRawResponse {
  type: "readRawResponse";
  sessionId: string;
  rawData: string;
}

export interface WSMessageServerSubscribedSession {
  type: "subscribed";
  sessionId: string;
}

export interface WSMessageServerUnsubscribedSession {
  type: "unsubscribed";
  sessionId: string;
}

export interface WSMessageServerError {
  type: "error";
  error: SerializedError;
}

export type WSMessageServer =
  | WSMessageServerSessionList
  | WSMessageServerSessionUpdate
  | WSMessageServerRawData
  | WSMessageServerReadRawResponse
  | WSMessageServerSubscribedSession
  | WSMessageServerUnsubscribedSession
  | WSMessageServerError;
