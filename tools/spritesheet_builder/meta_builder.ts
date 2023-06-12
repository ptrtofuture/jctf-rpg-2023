import path from "path";
import {SpritesheetData} from "../../share/map/spritesheet_data";
import {CollisionItem} from "../../share/collision/collision_data";
import {parseTiledCollisionData} from "../map_builder/tiled_collision_parser";

export function buildSpriteSheetMetadata(name: string, tlesetData: any, sprightData: any): SpritesheetData {
    const sprites: any = {};
    const spriteCollisionItems: {[name: string]: CollisionItem[]} = {};

    for (const sprite of sprightData.sprites) {
        const source = sprightData.sources[sprite.sourceIndex];
        const sourceFileName = path.parse(source.filename).name;
        const refId = source.spriteIndices.length > 1 ? sourceFileName + "." + sprite.inputSpriteIndex : sourceFileName;
        sprites[refId] = [sprite.rect.x, sprite.rect.y, sprite.rect.x + sprite.rect.w, sprite.rect.y + sprite.rect.h];
    }
    for (const tile of tlesetData.tiles) {
        const refId = tile.properties.find((x: any) => x.name === 'sprite_refid').value;
        if (tile.objectgroup?.objects?.length > 0)
            spriteCollisionItems[refId] = parseTiledCollisionData(tile.objectgroup.objects);
    }

    return {
        name,
        width: sprightData.textures[0].width,
        height: sprightData.textures[0].height,
        sprites,
        spriteCollisionItems
    };
}
