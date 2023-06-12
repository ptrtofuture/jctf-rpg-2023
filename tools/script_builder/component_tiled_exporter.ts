import * as fs from "fs";
import {ScriptComponentMetaFile} from "../../share/script/component_meta_data";

const CUSTOM_ID_START = 100;

export function updateTiledProject(projectPath: string, componentMeta: ScriptComponentMetaFile) {
    const projectData = JSON.parse(fs.readFileSync(projectPath).toString());
    projectData.propertyTypes = projectData.propertyTypes.filter((x: any) => x.id < CUSTOM_ID_START);

    let id = CUSTOM_ID_START;
    for (const [cName, cData] of Object.entries(componentMeta.components)) {
        const members: any = [];
        for (const [pName, pType] of Object.entries(cData.props)) {
            members.push({
                name: pName,
                type: pType,
                value: cData.defaults[pName]
            })
        }

        projectData.propertyTypes.push({
            color: '#ffa0a0a4',
            drawFill: true,
            id: id++,
            name: cName,
            type: 'class',
            useAs: ['property', 'object'],
            members: members
        });
    }

    fs.writeFileSync(projectPath, JSON.stringify(projectData, null, 4));
}
