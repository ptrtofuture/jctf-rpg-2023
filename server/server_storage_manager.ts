import {GamePersistentStorage, PersistentData} from "../share/game/game_persistent_storage";

export interface ServerStorageManager {
    checkToken(gameId: number, gameToken: string): Promise<boolean>;

    loadGame(gameId: number, gameToken: string): Promise<{storage: GamePersistentStorage, data: PersistentData|null}>;

    createNewGame(): Promise<{storage: GamePersistentStorage|null, data: PersistentData|null, gameId: number, gameToken: string}>;
}
