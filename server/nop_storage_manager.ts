import {ServerStorageManager} from "./server_storage_manager";
import {GamePersistentStorage, PersistentData} from "../share/game/game_persistent_storage";

export class NopStorageManager implements ServerStorageManager {
    checkToken(gameId: number, gameToken: string): Promise<boolean> {
        return Promise.resolve(false);
    }

    createNewGame(): Promise<{ storage: GamePersistentStorage | null; data: PersistentData | null; gameId: number; gameToken: string }> {
        return Promise.resolve({data: null, gameId: 0, gameToken: "", storage: null });
    }

    loadGame(gameId: number, gameToken: string): Promise<{ storage: GamePersistentStorage; data: PersistentData | null }> {
        return Promise.reject('Loading game not supported');
    }
}
