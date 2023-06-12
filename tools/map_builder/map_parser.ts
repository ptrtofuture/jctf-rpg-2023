import * as path from "path";
import {
    MapChunkData,
    MapFullData,
    MapMetaData,
    TilesetData
} from "../../share/map/map_data";
import {CollisionItem} from "../../share/collision/collision_data";
import {parseTiledCollisionData} from "./tiled_collision_parser";
import {MAP_EPSILON} from "../../share/map/map_entity_loader";

export function loadTileset(name: string, tileset: any): TilesetData {
    const tileCollisionItems: CollisionItem[][] = [];

    for (const tile of tileset.tiles) {
        if (tile.objectgroup?.objects)
            tileCollisionItems[tile.id] = parseTiledCollisionData(tile.objectgroup.objects);
    }

    return {
        name,
        count: tileset.tilecount,
        columns: tileset.columns,
        tileWidth: tileset.tilewidth,
        tileHeight: tileset.tileheight,
        tileCollisionItems: tileCollisionItems
    };
}

function getSpritesheetName(fileName: string) {
    fileName = path.basename(fileName);
    if (!fileName.endsWith('_spritesheet.tsj'))
        throw new Error('Spritesheet file name must follow convention');
    return fileName.substring(0, fileName.length - '_spritesheet.tsj'.length);
}

export function loadSpritesheetTileset(fileName: string, tileset: any, gidToSpriteRefId: {[key: string]: string}) {
    const name = getSpritesheetName(fileName);
    for (const tile of tileset.tiles) {
        const refId = tile.properties.find((x: any) => x.name === 'sprite_refid').value;
        gidToSpriteRefId[`${name}.${tile.id}`] = refId;
    }
}

export function loadMap(name: string, map: any, gidToSpriteRefId: {[key: string]: string}): MapFullData {
    const mainTilelayer = map.layers.find((x: any) => x.type === 'tilelayer');
    const chunkWidth = mainTilelayer.chunks[0].width, chunkHeight = mainTilelayer.chunks[0].height;
    const chunkWidthPx = chunkWidth * map.tilewidth, chunkHeightPx = chunkHeight * map.tileheight;

    const tilesetSource = path.parse(map.tilesets[0].source).name;
    const tilesetFirstGid = map.tilesets[0].firstgid;
    const meta: MapMetaData = {
        name,
        tileset: tilesetSource,
        spritesheets: [],
        chunkWidth, chunkHeight
    };
    const chunks: {[pos: string]: MapChunkData} = {};
    const points: {[name: string]: {x: number, y: number}} = {};
    const entities: {[id: number]: any} = {};
    const globalEntities: number[] = [];
    const spritesheets = new Set<string>();

    const getChunk = (x: number, y: number) => {
        if (!chunks[`${x}.${y}`])
            chunks[`${x}.${y}`] = {x: x, y: y, tiles: {}};
        return chunks[`${x}.${y}`];
    };

    for (let i = 0; i < map.layers.length; i++) {
        const layer = map.layers[i];
        if (layer.type === 'tilelayer') {
            for (const chunk of layer.chunks) {
                const chunkX = Math.floor(chunk.x / chunkWidth);
                const chunkY = Math.floor(chunk.y / chunkHeight);
                getChunk(chunkX, chunkY).tiles[i] = chunk.data.map((x: number) => x - tilesetFirstGid);
            }
        } else if (layer.type === 'objectgroup') {
            for (const obj of layer.objects) {
                if (obj.type && obj.type.startsWith('Meta/')) {
                    if (obj.type === 'Meta/Point') {
                        const pointName = obj.properties.find((x: any) => x.name === 'name').value;
                        points[pointName] = {x: obj.x + obj.width / 2, y: obj.y + obj.height / 2};
                    } else {
                        console.error('Invalid meta object: ' + obj.type);
                    }
                    continue;
                }

                if (obj.width === 0 && obj.height === 0 && obj.polygon) {
                    const minX = obj.polygon.reduce((a: number, x: any) => Math.min(x.x, a), 0);
                    const minY = obj.polygon.reduce((a: number, x: any) => Math.min(x.y, a), 0);
                    const maxX = obj.polygon.reduce((a: number, x: any) => Math.max(x.x, a), 0);
                    const maxY = obj.polygon.reduce((a: number, x: any) => Math.max(x.y, a), 0);
                    obj.x += minX;
                    obj.y += minY;
                    obj.width = maxX - minX;
                    obj.height = maxY - minY;
                    obj.polygon = obj.polygon.map((x: any) => ({x: x.x - minX, y: x.y - minY}));
                }

                const props: any = {};
                props.transform = {
                    name: obj.name !== "" ? obj.name : undefined,
                    x: obj.x,
                    y: obj.y,
                    w: obj.width,
                    h: obj.height
                };
                entities[-obj.id] = props;

                let isGlobal = false;
                let addSpriteComponent = true;
                let spriteLayer = -1;
                for (const prop of (obj.properties || [])) {
                    if (prop.type === 'class') {
                        props[prop.name] = prop.value;
                        if (prop.name === 'shape_collider')
                            props[prop.name]['shape'] = parseTiledCollisionData([obj], obj.x, obj.y);
                    } else if (prop.type === 'bool') {
                        if (prop.name === 'global')
                            isGlobal = prop.value;
                        if (prop.name === 'sprite_auto_component')
                            addSpriteComponent = prop.value;
                    } else if (prop.type === 'int') {
                        if (prop.name === 'sprite_layer')
                            spriteLayer = prop.value;
                    }
                }

                if (addSpriteComponent && !props.sprite && obj.gid !== undefined) {
                    const spriteTileset = map.tilesets.findLast((x: any) => obj.gid >= x.firstgid);
                    const sheetName = getSpritesheetName(spriteTileset.source);
                    const refId = gidToSpriteRefId[sheetName + '.' + (obj.gid - spriteTileset.firstgid)];

                    spritesheets.add(sheetName);
                    props.sprite = {
                        spritesheet: sheetName,
                        sprite: refId
                    };
                    if (spriteLayer !== -1)
                        props.sprite.layer = spriteLayer;
                    props['renderer:sprite'] = {};
                }

                if (isGlobal) {
                    globalEntities.push(-obj.id);
                    continue;
                }

                let x1 = Math.floor(obj.x / chunkWidthPx), y1 = Math.floor(obj.y / chunkHeightPx);
                let x2 = Math.floor((obj.x + obj.width - MAP_EPSILON) / chunkWidthPx), y2 = Math.floor((obj.y + obj.height - MAP_EPSILON) / chunkHeightPx);
                if (props.persist_flag) {
                    x1 = x2 = Math.floor((obj.x + obj.width / 2) / chunkWidthPx);
                    y1 = y2 = Math.floor((obj.y + obj.height / 2) / chunkHeightPx);
                }
                for (let x = x1; x <= x2; x++) {
                    for (let y = y1; y <= y2; y++) {
                        const chunkData = getChunk(x, y);
                        if (!chunkData.entities)
                            chunkData.entities = [];
                        chunkData.entities.push(-obj.id);
                    }
                }
            }
        }
    }

    meta.spritesheets = [...spritesheets];
    return {meta, chunks, points, entities, globalEntities};
}

