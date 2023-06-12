import {NetImplBase} from "../share/net/net_impl_base";
import {WebSocket} from "ws";
import {Socket} from "node:net";
import {DisconnectInfo, DisconnectSource} from "../share/net/net_interface";
import {performance} from "perf_hooks";
import {clearInterval} from "timers";

export class NetWs extends NetImplBase {
    ws: WebSocket;
    client = false;
    private name: string;
    ip: string;
    private closed: boolean = false;
    lastPacketMs: number = -1;
    private pingCheckInterval?: NodeJS.Timer|undefined;

    constructor(ws: WebSocket, socket?: Socket, validationCallback?: (data: any) => void) {
        super();
        this.ws = ws;
        this.name = socket ? socket.remoteAddress + ':' + socket.remotePort : 'unknown';
        this.ip = socket?.remoteAddress || 'unknown';
        this.schemaValidationCallback = validationCallback;

        this.lastPacketMs = performance.now();

        ws.on('message', (data) => {
            if (this.closed)
                return;
            this.lastPacketMs = performance.now();
            this.onReceiveRaw(data.toString());
        });
        ws.on('close', () => this.disconnect({source: DisconnectSource.SOCKET_DISCONNECT}));
        ws.on('error', ev => {
            console.error('WebSocket error');
            console.error(ev);
            this.disconnect({source: DisconnectSource.HANDLE_ERROR, handleError: ev});
        });
    }

    enablePingTimeoutCheck(timeout: number, checkInterval: number) {
        if (this.closed)
            return;
        this.pingCheckInterval = setInterval(() => {
            if (performance.now() - this.lastPacketMs >= timeout)
                this.disconnect({source: DisconnectSource.TIMEOUT});
        }, checkInterval);
    }

    protected sendRaw(data: string): void {
        this.ws.send(data);
    }

    disconnect(info: DisconnectInfo) {
        this.closed = true;
        if (this.pingCheckInterval) {
            clearInterval(this.pingCheckInterval);
            this.pingCheckInterval = undefined;
        }
        try {
            this.ws.close();
        } catch (e) {
        }
        super.disconnect(info);
    }

    toString() {
        return this.name;
    }
}
