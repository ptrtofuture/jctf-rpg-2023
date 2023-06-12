import * as fs from "fs";
import path from "path";
import {spawnSync} from "node:child_process";
import {loadMap, loadSpritesheetTileset, loadTileset} from "./map_parser";

const mapDir = 'assets/map';
const mapBuildDir = 'assets/map/build';

const files = fs.readdirSync(mapDir);

const gidToSpriteRefId = {};

const tilesets: any = {};
for (const file of files) {
    if (file.endsWith('.tsj')) {
        const name = file.substring(0, file.length - 4);
        const src = JSON.parse(fs.readFileSync(path.join(mapDir, file)).toString());
        if (src.properties?.some((x: any) => x.name === 'spritesheet' && x.value)) {
            console.log('Processing spritesheet: ' + name);
            loadSpritesheetTileset(file, src, gidToSpriteRefId);
            continue;
        }
        if (src.properties?.some((x: any) => x.name === 'ignore' && x.value))
            continue;
        console.log('Processing tileset: ' + name);
        tilesets[name] = loadTileset(name, src);
    }
}
fs.writeFileSync('assets/static/tilesets.json', JSON.stringify(tilesets));


for (const file of files) {
    if (file.endsWith('.tmj')) {
        const name = file.substring(0, file.length - 4);
        console.log('Processing map: ' + name);
        const map = loadMap(name, JSON.parse(fs.readFileSync(path.join(mapDir, file)).toString()), gidToSpriteRefId);
        fs.writeFileSync(path.join(mapBuildDir, name + '.json'), JSON.stringify(map));
    }
}
