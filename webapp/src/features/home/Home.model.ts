import type { HomeState } from './Home.controller';
export interface HomeModel {
  state: HomeState;
  connectionId: string;
  repository: string;
  waitingOnly: boolean;
  actions: {
    setConnectionId(value: string): void;
    setRepository(value: string): void;
    setWaitingOnly(value: boolean): void;
    reconnect(): void;
    retry(id: string): void;
    addRepository(): void;
  };
}
