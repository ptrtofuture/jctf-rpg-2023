import {WebSocket, WebSocketServer} from 'ws';
import {Connection} from "./connection";
import {NetWs} from "./net_ws";
import {GameData} from "../share/game/game_data";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import {ScriptBlob} from "../share/script/blob";
import {PgConnectionManager} from "./database/pg_persistent_storage";
import {DistributedPlayerSessionManager, NopPlayerSessionManager, PlayerSessionManager} from "./player_session_manager";
import Ajv from "ajv";
import {NET_SERVER_SCHEMA} from "../share/net/rpc_schema";
import {ServerStorageManager} from "./server_storage_manager";
import {NopStorageManager} from "./nop_storage_manager";
import {PlayerLimitManager} from "./player_limit_manager";
import {BackpressureImpl} from "./backpressure_impl";


let portOverride = parseInt(process.argv[2]);

const localConfig = JSON.parse(fs.readFileSync("local_config.json").toString());
const config = JSON.parse(fs.readFileSync("assets/static/config.json").toString());

const blob = ScriptBlob.fromJson(JSON.parse(fs.readFileSync("assets/static/scriptblob.json").toString()));
blob.jsCode = vm.runInNewContext(fs.readFileSync("assets/static/scriptblob.js").toString());

const scriptComponentMeta = JSON.parse(fs.readFileSync("assets/static/scriptcomponents.json").toString());
const questMeta = JSON.parse(fs.readFileSync("assets/static/quests.json").toString());

const tilesets = JSON.parse(fs.readFileSync("assets/static/tilesets.json").toString());

const data = new GameData(config, blob, scriptComponentMeta, questMeta, tilesets);
data.mapData = {};
for (const file of fs.readdirSync('assets/map/build'))
    data.mapData[path.parse(file).name] = JSON.parse(fs.readFileSync(path.join('assets/map/build', file)).toString());
data.spritesheets = {};
for (const file of fs.readdirSync('assets/static/spritesheets'))
    if (file.endsWith(".json"))
        data.spritesheets[path.parse(file).name] = JSON.parse(fs.readFileSync(path.join('assets/static/spritesheets', file)).toString());

let validationCallback: ((data: any) => void) | undefined = undefined;
if (localConfig.validateSchema) {
    const ajv = new Ajv();
    const validate = ajv.compile(NET_SERVER_SCHEMA);

    validationCallback = (data) => {
        const valid = validate(data);
        if (!valid) {
            console.error(validate.errors);
            throw new Error('Schema invalid');
        }
    };
}

const port = portOverride || localConfig.listenPort || 8081;
const playerLimitManager = new PlayerLimitManager(localConfig.instancePlayerLimit);

function extendLog(fnName: string) {
    const logOrig = (console as any)[fnName];
    (console as any)[fnName] = function (...args: any) {
        logOrig.apply(console, ['[' + port + '] ' + new Date().toISOString()].concat(args));
    }
}
extendLog('log');
extendLog('warn');
extendLog('error');

function run(sessionManager: PlayerSessionManager, storageManager: ServerStorageManager) {
    const wss = new WebSocketServer({
        port: port,
        maxPayload: 8 * 1024
    });
    wss.on('connection', function connection(ws, req) {
        const net = new NetWs(ws, req.socket, validationCallback);
        net.enablePingTimeoutCheck(localConfig.playerTimeout, localConfig.playerTimeoutCheckInterval);
        // net.backpressure = new BackpressureImpl();
        console.log('[' + net.toString() + '] New connection');
        new Connection(data, net, playerLimitManager, sessionManager, storageManager, config.serverKey||null);
    });
    console.log('Server running');
}


if (localConfig.noDatabase) {
    run(new NopPlayerSessionManager(), new NopStorageManager());
} else {
    const ws = new WebSocket(localConfig.sessionServer.address);
    ws.on('open', () => {
        console.log('Connected to Session Server');

        const sessionManager = new DistributedPlayerSessionManager(new NetWs(ws), port.toString());
        const storageManager = new PgConnectionManager(localConfig.postgres);
        run(sessionManager, storageManager);
    });
}
