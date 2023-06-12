import {DisconnectSource, NetInterface} from "../share/net/net_interface";
import {ID_LOGIN_ERROR, ID_LOGIN_REQUEST, ID_LOGIN_RESPONSE, ID_LOGIN_WHITELIST_KEY} from "../share/net/packet_ids";
import {GameData} from "../share/game/game_data";
import {Player} from "../share/game/player";
import {ServerStorageManager} from "./server_storage_manager";
import {GamePersistentStorage, PersistentData} from "../share/game/game_persistent_storage";
import {PlayerSessionManager} from "./player_session_manager";
import {
    LOGIN_ERROR_DATABASE,
    LOGIN_ERROR_INVALID_TOKEN,
    LOGIN_ERROR_PLAYER_LIMIT,
    LOGIN_ERROR_SESSION_IP_LIMIT
} from "../share/net/login_errors";
import {PlayerLimitManager} from "./player_limit_manager";
import {SESSION_ERROR_IP_LIMIT, SessionError} from "./player_session_server_errors";

export class Connection {
    data: GameData;
    net: NetInterface;
    player: Player|null = null;
    playerLimitManager: PlayerLimitManager;
    storageManager: ServerStorageManager;
    sessionManager: PlayerSessionManager;
    gameId: number = -1;
    canLogin: boolean = true;
    disconnected: boolean = false;
    isOccupyingSlot: boolean = false;
    disconnectTask: Promise<void>|null = null;
    saveInterval: NodeJS.Timeout|null = null;

    constructor(data: GameData, net: NetInterface, playerLimitManager: PlayerLimitManager, sessionManager: PlayerSessionManager, storageManager: ServerStorageManager, serverKey: string|null) {
        this.data = data;
        this.net = net;
        this.playerLimitManager = playerLimitManager;
        this.storageManager = storageManager;
        this.sessionManager = sessionManager;
        this.canLogin = serverKey === null;

        net.addPacketHandler(ID_LOGIN_WHITELIST_KEY, (key) => {
            if (key === serverKey) {
                this.canLogin = true;
            }
        });
        net.addPacketHandler(ID_LOGIN_REQUEST, async (token) => {
            try {
                if (!this.canLogin || this.gameId !== -1 || this.isOccupyingSlot)
                    return;

                if (!playerLimitManager.startSession()) {
                    console.log('[' + this.net.toString() + '] Login request rejected due to player limit');
                    this.net.send(ID_LOGIN_ERROR, LOGIN_ERROR_PLAYER_LIMIT);
                    return;
                }
                this.isOccupyingSlot = true;
            } catch(e) {
                console.error(e);
                process.exit(1);
            }

            console.log('[' + this.net.toString() + '] Got login request!');

            const ip = net?.ip || net.toString();

            try {
                let gameId = null, gameToken = null;
                if (token !== null) {
                    const split = token.toString().split(':', 2);
                    gameId = parseInt(split[0]);
                    gameToken = split[1];

                    if (!(await this.storageManager.checkToken(gameId, gameToken))) {
                        console.error('[' + this.net.toString() + '] Failed to login player: bad token');
                        this.net.send(ID_LOGIN_ERROR, LOGIN_ERROR_INVALID_TOKEN);
                        this.releasePlayerSlot();
                        return;
                    }

                    console.log('[' + this.net.toString() + '] Logging into game: ' + gameId);
                    await sessionManager.loginToGame(gameId, ip, () => this.disconnect(DisconnectSource.SESSION_SERVER_REQUEST));
                    this.gameId = gameId;
                    console.log('[' + this.net.toString() + '] Login to game complete: ' + gameId);

                    const {storage, data} = await this.storageManager.loadGame(gameId, gameToken);
                    console.log('[' + this.net.toString() + '] Loaded into game: ' + gameId);
                    this.net.send(ID_LOGIN_RESPONSE, {
                        playerData: data?.playerData
                    });
                    this.createPlayer(storage, data);
                } else {
                    const {storage, data, gameId, gameToken} = await this.storageManager.createNewGame();
                    console.log('[' + this.net.toString() + '] Created a new game: ' + gameId);

                    await sessionManager.loginToGame(gameId, ip, () => this.disconnect(DisconnectSource.SESSION_SERVER_REQUEST));
                    this.gameId = gameId;
                    console.log('[' + this.net.toString() + '] Login to game complete: ' + gameId);

                    this.net.send(ID_LOGIN_RESPONSE, {
                        token: gameToken ? (gameId + ":" + gameToken) : "",
                        playerData: data?.playerData
                    })
                    this.createPlayer(storage, data);
                }
            } catch(err) {
                console.error('[' + this.net.toString() + '] Failed to login player', err);

                try {
                    if (err instanceof SessionError && err.code === SESSION_ERROR_IP_LIMIT)
                        this.net.send(ID_LOGIN_ERROR, LOGIN_ERROR_SESSION_IP_LIMIT);
                    else
                        this.net.send(ID_LOGIN_ERROR, LOGIN_ERROR_DATABASE);

                    if (this.gameId !== -1) {
                        this.sessionManager.gameLoggedOut(this.gameId);
                        this.gameId = -1;
                    }
                    this.releasePlayerSlot();
                } catch(e) {
                    console.error(e);
                    process.exit(1);
                }
            }
        });
        net.addDisconnectHandler((info) => {
            if (info.handleError)
                this.player?.persistence?.disableSavingDueToError();
            if (!this.disconnected)
                this.disconnect(info.source);
        });
    }

    createPlayer(storage: GamePersistentStorage|null, data: PersistentData|null) {
        if (this.disconnected)
            throw new Error("Disconnected");
        this.player = new Player(this.data, this.net, storage);
        this.player.onEnterGame(data?.playerData);

        this.saveInterval = setInterval(() => {
            try {
                this.player?.persistence?.saveGame();
            } catch (e) {
                console.error('[' + this.net.toString() + '] Periodic save failed');
                console.error(e);
            }
        }, 30000);
    }

    disconnect(source: DisconnectSource): Promise<void> {
        if (!this.disconnectTask)
            this.disconnectTask = this.disconnectImpl(source);
        return this.disconnectTask;
    }

    async disconnectImpl(source: DisconnectSource): Promise<void> {
        if (this.saveInterval)
            clearInterval(this.saveInterval);
        console.log('[' + this.net.toString() + '] Disconnected due to ' + DisconnectSource[source]);

        this.disconnected = true;
        try {
            this.net.disconnect({source});
        } catch (e) {
            console.error('[' + this.net.toString() + '] Disconnect error!');
            console.error(e);
        }

        if (!this.player) {
            this.releasePlayerSlot();
            return;
        }

        try {
            this.net.rpc.flushPendingSharedExecutions();
            await this.player.persistence!.saveGame();
        } catch (e) {
            console.error('[' + this.net.toString() + '] Save on disconnect error!');
            console.error(e);
        }
        this.releasePlayerSlot();
        console.log('[' + this.net.toString() + '] Disconnected (from game ' + this.gameId + ')');
        this.sessionManager.gameLoggedOut(this.gameId);
    }

    releasePlayerSlot() {
        if (this.isOccupyingSlot) {
            this.playerLimitManager.endSession();
            this.isOccupyingSlot = false;
        }
    }
}
