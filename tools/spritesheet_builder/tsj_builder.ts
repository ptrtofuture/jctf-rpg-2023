import path from "path";

export function buildTileset(name: string, oldTilesetData: any, sprightData: any) {
    const oldTileData: any = {};
    let nextId = 0;

    if (oldTilesetData?.tiles) {
        for (const tile of oldTilesetData?.tiles) {
            const refId = tile.properties.find((x: any) => x.name === 'sprite_refid').value;
            oldTileData[refId] = tile;
            nextId = Math.max(nextId, tile.id + 1);
        }
    }

    const tiles = [];
    let maxTileWidth = 0, maxTileHeight = 0;
    for (const sprite of sprightData.sprites) {
        const source = sprightData.sources[sprite.sourceIndex];
        const sourceFileName = path.parse(source.filename).name;
        const refId = source.spriteIndices.length > 1 ? sourceFileName + "." + sprite.inputSpriteIndex : sourceFileName;
        const oldTile = oldTileData[refId];

        maxTileWidth = Math.max(maxTileWidth, sprite.rect.w);
        maxTileHeight = Math.max(maxTileHeight, sprite.rect.h);

        tiles.push({
            id: oldTile !== undefined ? oldTile.id : nextId++,
            image: sprightData.textures[0].filename.substring(3), // remove the first ../ prefix
            imagewidth: sprightData.textures[0].width,
            imageheight: sprightData.textures[0].height,
            x: sprite.rect.x,
            y: sprite.rect.y,
            width: sprite.rect.w,
            height: sprite.rect.h,
            properties: [
                {
                    name: "sprite_refid",
                    type: "string",
                    value: refId
                },
                {
                    name: "sprite_auto_component",
                    type: "bool",
                    value: true
                },
                {
                    name: "sprite_layer",
                    type: "int",
                    value: 1
                }
            ],
            objectgroup: oldTile?.objectgroup
        });
    }


    return {
        columns: 0,
        grid: {
            height: 1,
            orientation: "orthogonal",
            width: 1
        },
        margin: 0,
        name: name,
        properties: [
            {
                name: "spritesheet",
                type: "bool",
                value: true
            }
        ],
        spacing: 0,
        objectalignment: "topleft",
        tilecount: 3,
        tiledversion: "1.10.1",
        tilewidth: maxTileWidth,
        tileheight: maxTileHeight,
        tiles: tiles,
        type: "tileset",
        version: "1.10"
    }
}
