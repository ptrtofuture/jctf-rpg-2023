import {CollisionItem} from "../../share/collision/collision_data";

export function parseTiledCollisionData(objects: any, refx: number = 0, refy: number = 0): CollisionItem[] {
    if (!objects)
        return [];

    const ret: CollisionItem[] = [];
    for (const object of objects) {
        if (object.polygon) {
            ret.push({
                type: 'polygon',
                x: object.x - refx,
                y: object.y - refy,
                points: object.polygon,
                rot: object.rotation || undefined
            })
        } else if (object.ellipse) {
            if (object.width !== object.height)
                throw new Error('Collision ellipses must be circles.');
            ret.push({
                type: 'circle',
                x: object.x + object.width / 2 - refx,
                y: object.y + object.height / 2 - refy,
                radius: object.width / 2
            });
        } else {
            ret.push({
                type: 'box',
                x: object.x - refx,
                y: object.y - refy,
                w: object.width,
                h: object.height,
                rot: object.rotation || undefined
            })
        }
    }
    return ret;
}
