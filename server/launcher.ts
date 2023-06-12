import * as child_process from "child_process";
import fs from "fs";


const localConfig = JSON.parse(fs.readFileSync("local_config.json").toString());
const targetProcessCount = parseInt(localConfig.launcherProcessCount);

let processes = [];

function startProcess(processNo: number) {
    const forked = child_process.fork('build/server/server.js', [localConfig.listenPort + processNo], {
        execPath: 'taskset',
        execArgv: ['-c', processNo.toString(), process.execPath, ...localConfig.launcherEnableProfiling && processNo === 0 ? ['--prof', '--trace-gc', '--heapsnapshot-signal=SIGUSR2'] : []]
    });
    forked.on('close', () => {
        console.warn('Subprocess has exited');
        setTimeout(() => startProcess(processNo), 1000);
    });
    processes.push(forked);
}

for (let i = 0; i < targetProcessCount; i++) {
    startProcess(i);
}
