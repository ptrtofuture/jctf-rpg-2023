import {WebSocket} from "ws";
import {
    ID_SESSION_SERVER_GET_METRICS_REQUEST, ID_SESSION_SERVER_GET_METRICS_RESPONSE
} from "../../share/net/packet_ids";
import fs from "fs";

type Metrics = {
    sessions: {
        id: number,
        playerIp: string,
        server: string
    }[],
    ipMap: {[ip: string]: number}
}

let serverList = JSON.parse(fs.readFileSync("tools/server_query/servers.json").toString());

async function main() {
    let promises: Promise<Metrics>[] = [];

    for (const server of serverList) {
        promises.push(new Promise<Metrics>((resolve, reject) => {
            const ws = new WebSocket(server);
            let timeout = setTimeout(() => {
                reject(new Error('timeout'));
                ws.close();
            }, 5000);
            ws.on('open', () => {
                ws.send(JSON.stringify([ID_SESSION_SERVER_GET_METRICS_REQUEST, {}]));
            });
            ws.on('message', data => {
                const msg = JSON.parse(data.toString());
                if (msg[0] == ID_SESSION_SERVER_GET_METRICS_RESPONSE) {
                    resolve(msg[1].metrics);
                    clearTimeout(timeout);
                    ws.close();
                }
            });
            ws.on('error', e => reject(e));
        }));
    }

    let results: {node: string, metrics: Metrics}[] = [];
    for (let i = 0; i < serverList.length; i++) {
        try {
            console.log('Getting metrics from ' + serverList[i]);
            const metrics = await promises[i];
            results.push({node: serverList[i], metrics});
            console.log(metrics);
        } catch (e) {
            console.error('Failed to get metrics from ' + serverList[i], e);
        }
    }

    let totalSessions = 0;
    const totalIpMap: {[ip: string]: number} = {};
    console.log('');
    for (const result of results) {
        const sessionCount = Object.values(result.metrics.sessions).length;
        let sessionsByServer: {[server: string]: number} = {};
        for (const session of Object.values(result.metrics.sessions)) {
            sessionsByServer[session.server] = (sessionsByServer[session.server] || 0) + 1;
        }
        console.log(result.node, '-', sessionCount + ' sessions', '-', sessionsByServer);
        totalSessions += sessionCount;
        for (const [ip, count] of Object.entries(result.metrics.ipMap)) {
            totalIpMap[ip] = (totalIpMap[ip] || 0) + count;
        }
    }
    console.log(totalSessions + ' total sessions');

    console.log('');
    console.log('Most sessions by IP:');
    const sortedIpList = Object.entries(totalIpMap).map(([k, v]) => [v, k]).sort().reverse() as [number, string][];
    for (const [count, ip] of sortedIpList) {
        if (count > 3)
            console.log(ip, count);
    }
}

main();
