import {Pool, PoolConfig} from 'pg';
import {
    GamePersistentStorage,
    PersistentChunkData,
    PersistentChunkDataMetaWrapper,
    PersistentData
} from "../../share/game/game_persistent_storage";
import {ServerStorageManager} from "../server_storage_manager";
import * as crypto from "crypto";


export class PgConnectionManager implements ServerStorageManager {
    readonly pool: Pool;

    constructor(config?: PoolConfig) {
        this.pool = new Pool(config);
    }

    async checkToken(gameId: number, gameToken: string): Promise<boolean> {
        const res = await this.pool.query(
            'SELECT game_id FROM games WHERE game_id = $1 AND game_token = $2',
            [gameId, gameToken]
        )
        return res.rowCount === 1;
    }

    async loadGame(gameId: number, gameToken: string) {
        const storage = new PgPersistentStorage(this, gameId);
        const data = await storage.loadGame(gameToken);
        return {storage, data};
    }

    async createNewGame() {
        const gameToken = crypto.randomBytes(24).toString('base64');

        const res = await this.pool.query('INSERT INTO games(game_token, data) VALUES($1, $2) RETURNING game_id', [gameToken, 'null']);
        return {
            storage: new PgPersistentStorage(this, res.rows[0].game_id),
            data: null,
            gameId: res.rows[0].game_id,
            gameToken
        };
    }
}

class PgPersistentStorage implements GamePersistentStorage {
    connectionManager: PgConnectionManager;
    gameId: number;

    constructor(connectionManager: PgConnectionManager, gameId: number) {
        this.connectionManager = connectionManager;
        this.gameId = gameId;
    }

    async loadGame(gameToken: string): Promise<PersistentData|null> {
        const res = await this.connectionManager.pool.query(
            'SELECT data FROM games WHERE game_id = $1 AND game_token = $2',
            [this.gameId, gameToken]
        )

        if (res.rowCount === 1) {
            await this.connectionManager.pool.query(
                'DELETE FROM game_chunks WHERE game_id = $1 AND volatile = TRUE',
                [this.gameId]
            )

            return JSON.parse(res.rows[0]['data']);
        }

        throw new Error('Game not found!');
    }

    async saveGame(data: PersistentData): Promise<void> {
        const client = await this.connectionManager.pool.connect();
        try {
            await client.query('BEGIN');

            // First delete old chunks that should be updated.
            await client.query(`
DELETE FROM game_chunks del 
       USING game_chunks vol
WHERE del.game_id = $1 AND vol.game_id = $1 AND del.world_name = vol.world_name AND del.x = vol.x AND del.y = vol.y AND 
      del.volatile = FALSE AND vol.volatile = TRUE
`, [this.gameId])

            // Next change the volatile chunks to non-volatile.
            await client.query(`
UPDATE game_chunks
SET volatile = FALSE
WHERE game_id = $1 AND volatile = TRUE
`, [this.gameId])

            // Finally update the player data.
            await client.query(`
UPDATE games
SET data = $2
WHERE game_id = $1
`, [this.gameId, Buffer.from(JSON.stringify(data))])

            await client.query('COMMIT');
        } catch(e) {
            await client.query('ROLLBACK')
            throw e;
        } finally {
            client.release();
        }
    }

    async loadChunk(worldName: string, x: number, y: number): Promise<PersistentChunkData|null> {
        const res = await this.connectionManager.pool.query(`
SELECT data FROM game_chunks
WHERE game_id = $1 AND world_name = $2 AND x = $3 AND y = $4
ORDER BY volatile DESC LIMIT 1
`, [this.gameId, worldName, x, y])

        if (res.rowCount === 1)
            return JSON.parse(res.rows[0]['data']);
        return null;
    }

    async saveChunk(worldName: string, x: number, y: number, data: PersistentChunkData): Promise<void> {
        await this.connectionManager.pool.query(`
INSERT INTO game_chunks (game_id, world_name, x, y, volatile, data) VALUES ($1, $2, $3, $4, TRUE, $5)
ON CONFLICT (game_id, world_name, x, y, volatile) DO UPDATE SET data = excluded.data
`, [this.gameId, worldName, x, y, Buffer.from(JSON.stringify(data))])
    }

    async saveChunks(entries: PersistentChunkDataMetaWrapper[]): Promise<void> {
        // TODO: optimize
        for (const entry of entries) {
            await this.saveChunk(entry.worldName, entry.x, entry.y, entry.data);
        }
    }

    toString() {
        return this.gameId.toString();
    }

}
