import {ID_RPC_QUEUE_EXECUTE_REQUEST} from "../share/net/packet_ids";
import {performance} from "perf_hooks";
import {Queue} from "../share/util/queue";
import {Backpressure} from "../share/net/net_impl_base";

const TIME_FRAME_PACKET_LIMIT = 4;
const TIME_FRAME_DURATION_MS = 30;
const MAX_QUEUED_PACKETS = 200;

export class BackpressureImpl implements Backpressure {
    private queue = new Queue<() => void>();

    private timeFrameStart: number = 0;
    private timeFramePacketCount: number = 0;
    private timeout: NodeJS.Timeout|undefined = undefined;
    private queueSize: number = 0;

    cancelPending() {
        clearTimeout(this.timeout);
        this.timeout = undefined;
    }

    check(packetId: number, packetData: any) {
        if (this.timeout !== undefined)
            return false;

        // We only need to backbuffer ticks at this time.
        if (packetId !== ID_RPC_QUEUE_EXECUTE_REQUEST || packetData[0] !== 'MapManager.tick')
            return true;

        if (++this.timeFramePacketCount <= TIME_FRAME_PACKET_LIMIT)
            return true;

        const now = performance.now();
        if (now >= this.timeFrameStart + TIME_FRAME_DURATION_MS) {
            this.timeFramePacketCount = 1;
            this.timeFrameStart = now;
            return true;
        }

        return false;
    }

    enqueue(cb: () => void) {
        if (this.queueSize >= MAX_QUEUED_PACKETS)
            throw new Error("Queue full");
        this.queue.push(cb);
        this.queueSize++;

        this.setTimeout();
    }

    private setTimeout() {
        if (this.timeout)
            return;
        this.timeout = setTimeout(() => {
            this.timeout = undefined;
            this.timeFramePacketCount = 0;
            this.timeFrameStart = performance.now();
            console.log('Running ' + this.queueSize + ' backpressured packets');
            while (this.timeFramePacketCount < TIME_FRAME_PACKET_LIMIT) {
                const pending = this.queue.pop();
                if (pending === null)
                    break;
                this.queueSize--;
                this.timeFramePacketCount++;
                pending();
            }
            if (this.queueSize > 0)
                this.setTimeout();
        }, TIME_FRAME_DURATION_MS);
    }
}
