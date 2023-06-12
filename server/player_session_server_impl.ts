import {WebSocketServer} from "ws";
import {NetWs} from "./net_ws";
import {DisconnectSource, NetInterface} from "../share/net/net_interface";
import {
    ID_SESSION_SERVER_CONFIG_DATA,
    ID_SESSION_SERVER_GET_METRICS_REQUEST,
    ID_SESSION_SERVER_GET_METRICS_RESPONSE,
    ID_SESSION_SERVER_KEEPALIVE,
    ID_SESSION_SERVER_LOGIN_REQUEST,
    ID_SESSION_SERVER_LOGIN_RESPONSE,
    ID_SESSION_SERVER_LOGOUT_REQUEST,
    ID_SESSION_SERVER_LOGOUT_RESPONSE,
    ID_SESSION_SERVER_SET_SERVER_NAME
} from "../share/net/packet_ids";
import {SESSION_ERROR_IP_LIMIT, SessionError} from "./player_session_server_errors";

export type PlayerSessionServerConfig = {
    address: string; // connection address
    port?: number;

    maxSessionsPerIp: number;

    // The following must be true: heartbeatTimeout <= heartbeatInterval, heartbeatTimeout + heartbeatInterval <= heartbeatSessionServerMaxSilence
    heartbeatInterval: number;
    heartbeatTimeout: number;
    heartbeatSessionServerMaxSilence: number;
}

type GameInfo = {
    conn: Connection;
    playerIp: string;
    logoutRequested?: boolean;
    logoutFinishCurrentCb?: () => void;
    logoutCancelCurrentCb?: (reason?: any) => void;
}

class Connection {
    readonly server: PlayerSessionServer;
    readonly net: NetInterface;
    name: string;
    games: {[gameId: number]: GameInfo} = {};
    private pingTimeout?: NodeJS.Timeout;
    private lastPing: Date|null = null;
    private disconnected: boolean = false;

    constructor(server: PlayerSessionServer, net: NetInterface) {
        this.server = server;
        this.net = net;
        this.name = net.toString();
        net.addPacketHandler(ID_SESSION_SERVER_SET_SERVER_NAME, name => {
            const nameUseNo = server.usedServerNames[name] || 1;
            server.usedServerNames[name] = nameUseNo + 1;
            this.name = nameUseNo > 1 ? (name + '-' + nameUseNo) : name;
            console.log(this.net.toString() + ' identified as: ' + this.name);
        });
        net.addPacketHandler(ID_SESSION_SERVER_LOGIN_REQUEST, data => {
            this.handleLoginRequest(data, () => {
                net.send(ID_SESSION_SERVER_LOGIN_RESPONSE, {requestId: data.requestId, gameId: data.gameId, result: true});
            }, x => {
                const errorCode = x instanceof SessionError ? x.code : undefined;
                net.send(ID_SESSION_SERVER_LOGIN_RESPONSE, {requestId: data.requestId, gameId: data.gameId, result: false, error: x.toString(), errorCode});
            });
        });
        net.addPacketHandler(ID_SESSION_SERVER_LOGOUT_REQUEST, data => {
            this.handleLogoutRequest(data);
            net.send(ID_SESSION_SERVER_LOGOUT_RESPONSE, {requestId: data.requestId, gameId: data.gameId, result: true});
        });
        net.addPacketHandler(ID_SESSION_SERVER_LOGOUT_RESPONSE, data => this.handleLogoutResponse(data));
        net.addPacketHandler(ID_SESSION_SERVER_GET_METRICS_REQUEST, (data) => {
            const metrics = this.handleMetricsRequest();
            net.send(ID_SESSION_SERVER_GET_METRICS_RESPONSE, {requestId: data.requestId, metrics, result: true});
        });
        net.addPacketHandler(ID_SESSION_SERVER_KEEPALIVE, data => this.handleKeepAlive(data));
        net.addDisconnectHandler(info => {
            if (info.handleError) {
                console.error(info.handleError);
                process.exit(1);
            }
            this.disconnect();
        });

        net.send(ID_SESSION_SERVER_CONFIG_DATA, server.config);
        this.handleKeepAlive(-1);
    }

    disconnect() {
        if (this.disconnected)
            return;

        if (this.pingTimeout)
            clearTimeout(this.pingTimeout);

        this.disconnected = true;
        console.log('Client ' + this.name + ' disconnected');
        for (const gameIdStr of Object.keys(this.games)) {
            const gameId = parseInt(gameIdStr);
            this.server.ipConnectionCounts.remove(this.games[gameId].playerIp);
            delete this.server.games[gameId];

            this.games[gameId].logoutFinishCurrentCb?.();
        }
        this.games = {};

        this.net.disconnect({source: DisconnectSource.SOCKET_DISCONNECT});
    }

    private handleKeepAlive(data: number) {
        this.lastPing = new Date();
        this.net.send(ID_SESSION_SERVER_KEEPALIVE, data);

        if (this.pingTimeout)
            clearTimeout(this.pingTimeout);
        this.pingTimeout = setTimeout(() => {
            console.log(this.name + ': ping timeout lastPing=' + this.lastPing + ' now=' + new Date());
            this.disconnect();
        }, this.server.config.heartbeatSessionServerMaxSilence);
    }

    handleLoginRequest({gameId, playerIp}: any, accept: () => void, reject: (e: Error) => void) {
        gameId = gameId.toString();

        console.log('Logging in to game ' + gameId + ' (server: ' + this.name + ')');

        const takeGame = () => {
            if (this.disconnected)
                return reject(new Error('disconnected'));

            if (gameId in this.games || gameId in this.server.games)
                throw new Error('state inconsistency');

            if (!this.server.ipConnectionCounts.check(playerIp))
                return reject(new SessionError(SESSION_ERROR_IP_LIMIT));
            this.server.ipConnectionCounts.add(playerIp);

            const gameInfo: GameInfo = {
                conn: this,
                playerIp
            };
            this.games[gameId] = gameInfo;
            this.server.games[gameId] = gameInfo;
            console.log('Logged in to game ' + gameId + ' (server: ' + this.name + ')');
            accept();
        };

        if (this.disconnected)
            return reject(new Error('disconnected'));

        if (gameId in this.server.games) {
            const oldGameInfo = this.server.games[gameId];

            if (oldGameInfo.logoutCancelCurrentCb)
                oldGameInfo.logoutCancelCurrentCb(new Error('Another logout requested.'));

            oldGameInfo.logoutFinishCurrentCb = takeGame;
            oldGameInfo.logoutCancelCurrentCb = reject;

            if (!oldGameInfo.logoutRequested) {
                console.log('Requested log out from game ' + gameId + ' from server: ' + this.name);
                oldGameInfo.logoutRequested = true;
                oldGameInfo.conn.net.send(ID_SESSION_SERVER_LOGOUT_REQUEST, {requestId: -1, gameId});
            }
        } else {
            takeGame();
        }
    }

    handleLogoutRequest({gameId}: any) {
        if (gameId in this.games) {
            console.log('Logged out from game ' + gameId + ' (server: ' + this.name + ')');
            const game = this.games[gameId];
            this.server.ipConnectionCounts.remove(game.playerIp);
            delete this.games[gameId];
            delete this.server.games[gameId];
            game.logoutFinishCurrentCb?.();
        }
    }

    handleLogoutResponse({gameId, result, error}: any) {
        console.log('Got log out response for ' + gameId + ': ' + result + ' ' + error + ' (server: ' + this.name + ')');
        if (result) // if logout succeeded, we already have got a logout request message
            return;

        if (gameId in this.games) {
            this.games[gameId].logoutRequested = false;
            this.games[gameId].logoutCancelCurrentCb?.(new Error(error));
        }
    }

    handleMetricsRequest() {
        return {
            sessions: Object.entries(this.server.games).map(([id, x]) => ({id, playerIp: x.playerIp, server: x.conn.name})),
            ipMap: this.server.ipConnectionCounts.counts
        };
    }
}

class IpConnectionCountManager {
    readonly counts: {[ip: string]: number} = {};
    readonly maxCount: number;

    constructor(maxCount: number) {
        this.maxCount = maxCount;
    }

    check(ip: string) {
        return !this.counts[ip] || this.counts[ip] < this.maxCount;
    }

    add(ip: string) {
        this.counts[ip] = (this.counts[ip] || 0) + 1;
    }

    remove(ip: string) {
        if (--this.counts[ip] == 0)
            delete this.counts[ip];
    }
}

export class PlayerSessionServer {
    readonly config: PlayerSessionServerConfig;
    readonly games: {[gameId: number]: GameInfo} = {};
    readonly usedServerNames: {[name: string]: number} = {};
    readonly ipConnectionCounts: IpConnectionCountManager;

    constructor(config: PlayerSessionServerConfig) {
        this.config = config;
        this.ipConnectionCounts = new IpConnectionCountManager(config.maxSessionsPerIp);

        const wss = new WebSocketServer({
            port: config.port || 8089
        });
        wss.on('connection', (ws, req) => {
            const net = new NetWs(ws, req.socket);
            console.log('New connection to session server: ' + net.toString());
            new Connection(this, net);
        });
    }
}
