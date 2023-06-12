import * as fs from "fs";
import path from "path";
import {spawnSync} from "node:child_process";
import {buildTileset} from "./tsj_builder";
import {buildSpriteSheetMetadata} from "./meta_builder";

const localConfig = JSON.parse(fs.readFileSync('local_config.json').toString());

const mapDir = 'assets/map';
const spriteDir = 'assets/entity';
const mapBuildDir = 'assets/map/build';
const metaDir = 'assets/static/spritesheets';

const folders = fs.readdirSync(spriteDir);

for (const folder of folders) {
    const folderPath = path.join(spriteDir, folder);
    const sprightJsonFile = path.resolve(path.join(mapBuildDir, "spright_" + folder + ".json"));
    const tsjFile = path.join(mapDir, folder + "_spritesheet.tsj");
    const metaFile = path.join(metaDir, folder + ".json");

    if (!fs.existsSync(path.join(folderPath, 'spright.conf')))
        continue;

    console.log('Building: ' + folder);
    const obj = spawnSync(localConfig.sprightBin, ["-o", sprightJsonFile], {
        cwd: folderPath
    });
    if (obj.status !== 0)
        throw new Error("Failed to run spright: "+ obj.stderr);

    const sprightData = JSON.parse(fs.readFileSync(sprightJsonFile).toString());
    let oldTilesetData = undefined;
    if (fs.existsSync(tsjFile))
        oldTilesetData = JSON.parse(fs.readFileSync(tsjFile).toString());

    let tsjData = buildTileset(folder, oldTilesetData, sprightData);
    fs.writeFileSync(tsjFile, JSON.stringify(tsjData, null, 4));

    const metadata = buildSpriteSheetMetadata(folder, tsjData, sprightData);
    fs.writeFileSync(metaFile, JSON.stringify(metadata));
}
