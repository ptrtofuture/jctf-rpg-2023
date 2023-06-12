import {WebSocket} from "ws";
import {
    ID_LOGIN_ERROR,
    ID_LOGIN_REQUEST, ID_LOGIN_RESPONSE,
    ID_LOGIN_WHITELIST_KEY, ID_PING, ID_PONG,
    ID_RPC_QUEUE_EXECUTE_DONE,
    ID_RPC_QUEUE_EXECUTE_REQUEST, ID_RPC_SHARED_EXECUTE
} from "../../share/net/packet_ids";
import fs, {WriteStream} from "fs";
import {Queue} from "../../share/util/queue";
import {GameKey} from "../../share/input/game_keys";
import {TICK_RATE} from "../../share/map/map_manager";


interface Reporting {
    onConnected(connId: number): void;
    onLoggedIn(connId: number): void;
    onDisconnected(connId: number): void;
    onPingResult(connId: number, ping: number): void;
    onServerMetrics(connId: number, metrics: {[key: string]: number}): void;
    onSendRpc(connId: number, rpcName: string): void;
    onReceiveRpc(connId: number, rpcName: string): void;
}

class TestConnection {
    ws: WebSocket;
    connId: number;
    reporting: Reporting;
    closed: boolean = false;
    loggedIn: boolean = false;
    token: string|null = null;
    private logInCallbacks: (() => void)[] = [];
    private waitingForRpcs = new Set<(rpcName: string, data: any) => void>();
    private msgQueue = new Queue<[string, any]>();
    private pingInterval: NodeJS.Timer|null = null;

    constructor(ws: WebSocket, connId: number, reporting: Reporting) {
        this.ws = ws;
        this.connId = connId;
        this.reporting = reporting;
        ws.on('message', (data) => {
            if (this.closed)
                return;
            this.onReceive(JSON.parse(data.toString()));
        });
    }

    onReceive(data: any) {
        // console.log(data);
        if (data[0] === ID_LOGIN_RESPONSE) {
            this.token = data[1].token;
            console.log('Logged in: ' + this.token);
            this.reporting.onLoggedIn(this.connId);
            this.loggedIn = true;
            for (const cb of this.logInCallbacks)
                cb();
            this.logInCallbacks = [];

            this.pingInterval = setInterval(() => {
                this.send([ID_PING, new Date().getTime()]);
                // this.send([ID_RPC_SHARED_EXECUTE, ['Debug.reportMetrics']]);
            }, 50);
        }
        if (data[0] === ID_LOGIN_ERROR)
            this.ws.close();
        if (data[0] === ID_RPC_QUEUE_EXECUTE_REQUEST) {
            this.reporting.onReceiveRpc(this.connId, data[1][0]);
            if (data[1][0] === 'Debug.reportMetricsResponse')
                this.reporting.onServerMetrics(this.connId, data[1][1]);

            if (this.waitingForRpcs.size > 0) {
                for (const cb of [...this.waitingForRpcs])
                    cb(data[1][0], data[1][1]);
            } else {
                this.msgQueue.push(data[1]);
            }
            this.send([ID_RPC_QUEUE_EXECUTE_DONE, null]);
        }
        if (data[0] === ID_PONG) {
            this.reporting.onPingResult(this.connId, new Date().getTime() - data[1]);
        }
        /*
        if (data[0] === ID_RPC_TIMING_REPORT) {
            const fnName = data[1][0];
            const value = data[1][1];
            this.reporting.onServerMetrics(this.connId, {[fnName]: value});
        }
        */
    }

    send(data: any) {
        // console.log(data);
        this.ws.send(JSON.stringify(data));
    }

    waitForLogIn(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.loggedIn) {
                resolve();
            } else {
                this.logInCallbacks.push(resolve);
            }
        });
    }

    waitForRpc(rpcName: string|string[], filter?: (data: any, rpcName: string) => boolean): Promise<[string, any]> {
        if (typeof rpcName === 'string')
            rpcName = [rpcName];
        return new Promise((resolve, reject) => {
            const cb = (pRpcName: string, pData: any) => {
                if (rpcName.includes(pRpcName) && (filter === undefined || filter(pData, pRpcName))) {
                    this.waitingForRpcs.delete(cb);
                    resolve([pRpcName, pData]);
                }
            };
            this.waitingForRpcs.add(cb);

            while (this.waitingForRpcs.size > 0 && this.msgQueue.peek() !== null) {
                const q = this.msgQueue.pop()!;
                cb(q[0], q[1]);
            }
        });
    }

    sendRpc(rpcName: string, ...rpcArgs: any) {
        this.reporting.onSendRpc(this.connId, rpcName);
        this.send([ID_RPC_SHARED_EXECUTE, [rpcName, ...rpcArgs]]);
    }
}

type ConnectConfig = {
    target: string[],
    serverKey: string|null
}

let gi = 0;

function connection(connId: number, reporting: Reporting, connectConfig: ConnectConfig, test: (conn: TestConnection) => Promise<void>) {
    const ws = new WebSocket(connectConfig.target[(gi++) % connectConfig.target.length]);
    ws.on('open', () => {
        reporting.onConnected(connId);
        const conn = new TestConnection(ws, connId, reporting);
        conn.send([ID_LOGIN_WHITELIST_KEY, connectConfig.serverKey])
        // conn.send([ID_LOGIN_REQUEST, '3331:8kVsNDp+Amg7bElNlEJlIEGB/LRudESy']);
        conn.send([ID_LOGIN_REQUEST, null]);
        test(conn).then(() => ws.close());
    });
    ws.on('close', () => reporting.onDisconnected(connId));
}

const tests: {[key: string]: (conn: TestConnection) => Promise<void>} = {};

async function loadIntoWorld(conn: TestConnection) {
    await conn.waitForLogIn();
    conn.sendRpc('Debug.setEnforceTickRate', false);
    await conn.waitForRpc('MapManager.enter');
    conn.sendRpc('MapManager.tick');
    conn.sendRpc('MapManager.clientTilesetLoaded', 'main_tileset');
    conn.sendRpc('MapManager.clientSpritesheetLoaded', 'main_map');
    conn.sendRpc('MapManager.clientSpritesheetLoaded', 'player');
    conn.sendRpc('MapManager.tick');
    for (let i = 0; i < 6; i++)
        await conn.waitForRpc('MapManager.loadChunk');
    conn.sendRpc('MapManager.tick');
    await conn.waitForRpc('MapManager.finishEnter');
}
async function waitMapRenter(conn: TestConnection) {
    await conn.waitForRpc('MapManager.enter');
    conn.sendRpc('MapManager.tick');
    while (true) {
        const [rpcName, _] = await conn.waitForRpc(['MapManager.loadChunk', 'MapManager.finishEnter']);
        if (rpcName === 'MapManager.finishEnter')
            return;
        conn.sendRpc('MapManager.tick');
        await new Promise(r => setTimeout(r, 1000 / TICK_RATE));
    }
}
async function teleportToPoint(conn: TestConnection, pointName: string) {
    conn.sendRpc('Debug.tp', pointName);
    await waitMapRenter(conn);
}
async function updateWithKeys(conn: TestConnection, keys: GameKey[], ticks: number) {
    for (const key of keys)
        conn.sendRpc('InputManager.setKey', 0, key, true);
    for (let i = 0; i < ticks; i++) {
        conn.sendRpc('MapManager.tick');
        await new Promise(r => setTimeout(r, 1000 / TICK_RATE));
    }
    for (const key of keys)
        conn.sendRpc('InputManager.setKey', 0, key, false);
}

tests['trial_of_data_spawn_area'] = async (conn) => {
    await loadIntoWorld(conn);
    await teleportToPoint(conn, 'labyrinth_respawn_1');

    let doInteract = true;
    while (true) {
        await updateWithKeys(conn, [GameKey.MoveRight], 110);
        await updateWithKeys(conn, [GameKey.MoveUp], 40);
        if (doInteract) {
            await updateWithKeys(conn, [GameKey.Interact], 1);
            conn.sendRpc('DialogueModel.completeDialogue');
            conn.sendRpc('DialogueModel.completeDialogue');
            conn.sendRpc('DialogueModel.completeChoice', 0);
            conn.sendRpc('DialogueModel.completeDialogue');
            doInteract = false;
        }
        await updateWithKeys(conn, [GameKey.MoveDown], 40);
        await updateWithKeys(conn, [GameKey.MoveRight], 40);
        await updateWithKeys(conn, [GameKey.MoveDown], 170);
        await updateWithKeys(conn, [GameKey.MoveRight], 180);
        await updateWithKeys(conn, [GameKey.MoveDown], 20);
        await waitMapRenter(conn);
    }
};
tests['trial_of_data_stand_on_respawn_2'] = async (conn) => {
    await loadIntoWorld(conn);
    await teleportToPoint(conn, 'labyrinth_respawn_2');
    await updateWithKeys(conn, [], 1000000000);
};
tests['nop'] = async (conn) => {
    await new Promise(r => setTimeout(r, 100000));
};


class ReportingImpl implements Reporting {
    connected = new Set<number>();
    loggedIn = new Set<number>();
    metrics: {[key: string]: number[]} = {};
    sentRpcs: {[key: string]: number} = {};
    receivedRpcs: {[key: string]: number} = {};
    metricLog: WriteStream;

    constructor() {
        this.metricLog = fs.createWriteStream('tools/stress_tester/metrics.txt', {flags: 'w'});
    }

    onConnected(connId: number): void {
        this.connected.add(connId);
    }

    onDisconnected(connId: number): void {
        this.connected.delete(connId);
        this.loggedIn.delete(connId);
    }

    onLoggedIn(connId: number): void {
        this.loggedIn.add(connId);
    }

    onPingResult(connId: number, ping: number) {
        this.onServerMetrics(connId, {ping: ping});
    }

    onServerMetrics(connId: number, metrics: { [p: string]: number }) {
        for (const [k, v] of Object.entries(metrics)) {
            if (!this.metrics[k])
                this.metrics[k] = [];
            this.metrics[k].push(v);
        }
    }

    onSendRpc(connId: number, rpcName: string) {
        this.sentRpcs[rpcName] = (this.sentRpcs[rpcName] || 0) + 1;
    }

    onReceiveRpc(connId: number, rpcName: string) {
        this.receivedRpcs[rpcName] = (this.receivedRpcs[rpcName] || 0) + 1;
    }

    print() {
        console.log();
        console.log(`Connected: ${this.loggedIn.size}/${this.connected.size}`);
        for (const [k, results] of Object.entries(this.metrics)) {
            const vAvg = results.reduce((x, a) => x + a, 0) / results.length;
            const vMin = results.reduce((x, a) => Math.min(x, a), 1000000);
            const vMax = results.reduce((x, a) => Math.max(x, a), 0);
            console.log(k + ': Avg=' + vAvg + ' Min=' + vMin + ' Max=' + vMax);
        }
        console.log('Ticks=' + this.sentRpcs['MapManager.tick'] + ' ChunkLoads=' + this.receivedRpcs['MapManager.loadChunk']);

        this.metricLog.write(JSON.stringify(this.metrics) + '\n');
        this.metrics = {};
        this.receivedRpcs = {};
        this.sentRpcs = {};
    }

}


type Config = {
    connect: ConnectConfig,
    groups: {
        test: string,
        connections: number,
        rampUp: number,
        rampUpInterval: number,
    }[]
}

function main() {
    const config: Config = JSON.parse(fs.readFileSync("tools/stress_tester/config.json").toString());
    const reporting = new ReportingImpl();
    setInterval(() => reporting.print(), 2000);

    let connId = 0;
    for (const group of config.groups) {
        let count = 0;
        setInterval(() => {
            if (count >= group.connections)
                return;

            connection(connId++, reporting, config.connect, tests[group.test]);
            count++;
        }, group.rampUpInterval);
    }
}

main();
