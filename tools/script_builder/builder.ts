import {ScriptParser} from "./parser";
import * as fs from "fs";
import path from "path";
import {ScriptBlob} from "../../share/script/blob";
import vm from "vm";
import {generateComponentMeta} from "./component_meta_info";
import {updateTiledProject} from "./component_tiled_exporter";
import {generateQuestMeta} from "./quest_meta_info";

const parser = new ScriptParser();

function parseScripts(dir: string) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
            if (file.name !== 'build')
                parseScripts(filePath);
        } else {
            const allFileContents = fs.readFileSync(filePath, 'utf-8');
            parser.parse(allFileContents.split('\n'), filePath);
        }
    }
}
parseScripts('assets/script');


fs.writeFileSync('assets/static/scriptblob.json', JSON.stringify(parser.toBlob().toJson()));
const script = parser.toJsScript();
fs.writeFileSync('assets/static/scriptblob.js', script.code);
fs.writeFileSync('assets/static/scriptblob.min.js', script.minCode);
fs.writeFileSync('assets/static/scriptblob.min.js.map', script.minMap);

const blob = ScriptBlob.fromJson(JSON.parse(fs.readFileSync("assets/static/scriptblob.json").toString()));
blob.jsCode = vm.runInNewContext(fs.readFileSync("assets/static/scriptblob.js").toString());

const componentMeta = generateComponentMeta(blob);
fs.writeFileSync('assets/static/scriptcomponents.json', JSON.stringify(componentMeta));
updateTiledProject('assets/map/map.tiled-project', componentMeta);

const questMeta = generateQuestMeta(blob);
fs.writeFileSync('assets/static/quests.json', JSON.stringify(questMeta));
