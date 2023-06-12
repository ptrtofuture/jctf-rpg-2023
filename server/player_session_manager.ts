import {NetInterface} from "../share/net/net_interface";
import {
    ID_SESSION_SERVER_CONFIG_DATA, ID_SESSION_SERVER_KEEPALIVE,
    ID_SESSION_SERVER_LOGIN_REQUEST, ID_SESSION_SERVER_LOGIN_RESPONSE,
    ID_SESSION_SERVER_LOGOUT_REQUEST,
    ID_SESSION_SERVER_LOGOUT_RESPONSE, ID_SESSION_SERVER_SET_SERVER_NAME
} from "../share/net/packet_ids";
import {PlayerSessionServerConfig} from "./player_session_server_impl";
import {SessionError} from "./player_session_server_errors";

export interface PlayerSessionManager {
    loginToGame(gameId: number, playerIp: string, logoutRequestCb: () => Promise<void>): Promise<void>;

    gameLoggedOut(gameId: number): void;
}

export class NopPlayerSessionManager implements PlayerSessionManager {
    gameLoggedOut(gameId: number): void {
    }

    loginToGame(gameId: number, playerIp: string, logoutRequestCb: () => Promise<void>): Promise<void> {
        return Promise.resolve(undefined);
    }
}


type LocalGameInfo = {
    logoutRequestCb: () => Promise<void>;
    logoutRequested: boolean;
}

export class DistributedPlayerSessionManager {
    private readonly net: NetInterface;
    private readonly localGames: {[id: number]: LocalGameInfo} = {};
    private readonly rpcHandlers: {[id: number]: (result: boolean, error?: string, errorCode?: string) => void} = {};
    private nextRpcId: number = 0;
    private pingId: number = 0;
    private pingTimeout?: NodeJS.Timeout;
    private lastPing: Date|null = null;
    private config?: PlayerSessionServerConfig;

    constructor(net: NetInterface, serverName: string) {
        this.net = net;
        net.addPacketHandler(ID_SESSION_SERVER_LOGOUT_REQUEST, data => {
            this.logOutLocalGame(data.gameId).then(() => {
                net.send(ID_SESSION_SERVER_LOGOUT_RESPONSE, {requestId: data.requestId, gameId: data.gameId, result: true});
            }).catch(x => {
                net.send(ID_SESSION_SERVER_LOGOUT_RESPONSE, {requestId: data.requestId, gameId: data.gameId, result: false, error: x.toString()});
            });
        });
        net.addPacketHandler(ID_SESSION_SERVER_LOGOUT_RESPONSE, () => {});
        net.addPacketHandler(ID_SESSION_SERVER_LOGIN_RESPONSE, data => this.handleRpcResponse(data));

        net.addPacketHandler(ID_SESSION_SERVER_CONFIG_DATA, data => this.handleSessionServerConfig(data));
        net.addPacketHandler(ID_SESSION_SERVER_KEEPALIVE, data => this.handleKeepAlive(data));

        net.addDisconnectHandler(info => {
            if (info.handleError) {
                console.error('Session Server handling error:');
                console.error(info.handleError);
            }
            this.onDisconnect();
        });

        net.send(ID_SESSION_SERVER_SET_SERVER_NAME, serverName);

        setTimeout(() => {
            if (!this.config) {
                console.error('Did not receive server configuration from the session server');
                this.onDisconnect();
            }
        }, 1000);

        this.localGames = {};
    }

    private onDisconnect() {
        console.error('Disconnected from Session Server. The server may not continue.');
        process.exit(1);
    }

    private handleSessionServerConfig(data: PlayerSessionServerConfig) {
        this.config = data;
        setInterval(() => {
            this.net.send(ID_SESSION_SERVER_KEEPALIVE, ++this.pingId);

            if (this.pingTimeout) {
                console.error('Ping timeout [in next ping] lastPing=' + this.lastPing + ' now=' + new Date());
                this.onDisconnect();
                return;
            }

            this.pingTimeout = setTimeout(() => {
                console.error('Ping timeout lastPing=' + this.lastPing + ' now=' + new Date());
                this.onDisconnect();
            }, data.heartbeatTimeout);
        }, data.heartbeatInterval);
    }

    private handleKeepAlive(data: number) {
        if (data !== this.pingId) {
            if (data !== -1)
                console.error('Ping response from session server with wrong id: ' + data + ' vs ' + this.pingId);
            return;
        }
        this.lastPing = new Date();
        if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
            this.pingTimeout = undefined;
        }
    }

    private handleRpcResponse(data: any) {
        if (!(data.requestId in this.rpcHandlers))
            return;
        this.rpcHandlers[data.requestId](data.result, data.error, data.errorCode);
        delete this.rpcHandlers[data.requestId];
    }

    private logOutLocalGame(gameId: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!(gameId in this.localGames)) {
                resolve();
                return;
            }

            const game = this.localGames[gameId];
            if (game.logoutRequested)
                reject('Logout already requested');

            game.logoutRequested = true;
            game.logoutRequestCb().then(resolve).catch(reject);
        });
    }

    loginToGame(gameId: number, playerIp: string, logoutRequestCb: () => Promise<void>): Promise<void> {
        return new Promise((resolve, reject) => {
            const requestId = this.nextRpcId++;
            this.rpcHandlers[requestId] = (result, error, errorCode) => {
                if (result) {
                    if (gameId in this.localGames)
                        throw new Error("Illegal state");
                    this.localGames[gameId] = {
                        logoutRequestCb,
                        logoutRequested: false
                    };
                    resolve();
                } else {
                    if (errorCode)
                        reject(new SessionError(errorCode));
                    reject(new Error('Got error from session server: ' + error));
                }
            };
            this.net.send(ID_SESSION_SERVER_LOGIN_REQUEST, {requestId, playerIp, gameId});
        });
    }

    gameLoggedOut(gameId: number) {
        if (!(gameId in this.localGames))
            throw new Error("Illegal state");

        this.net.send(ID_SESSION_SERVER_LOGOUT_REQUEST, {requestId: -1, gameId});
        delete this.localGames[gameId];
    }
}
