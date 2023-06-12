import {ScriptBlob} from "../../share/script/blob";
import {StaticEvalCtx} from "../../share/script/eval_ctx";
import {ScriptEvaluator} from "../../share/script/evaluator";
import {ScriptComponentMetaFile} from "../../share/script/component_meta_data";

export function generateComponentMeta(blob: ScriptBlob): ScriptComponentMetaFile {
    const componentNames = collectComponentNames(blob);

    const ret: any = {}
    for (const name of componentNames) {
        const o: any = {components: [], props: {}, defaults: {}};

        let ctx = new StaticEvalCtx(blob);
        ScriptEvaluator.start(ctx, `component.${name}.meta`);
        if (ScriptEvaluator.update(ctx))
            throw new Error('Evaluation did not complete');
        for (const k of Object.getOwnPropertyNames(ctx.jsProps))
            o[k] = ctx.jsProps[k];

        ctx = new StaticEvalCtx(blob);
        ctx.jsContext.self = o.defaults;
        ScriptEvaluator.start(ctx, `component.${name}.construct`);
        if (ScriptEvaluator.update(ctx))
            throw new Error('Evaluation did not complete');

        ret[name] = o;
    }
    return {components: ret};
}

function collectComponentNames(blob: ScriptBlob) {
    const ret = new Set<string>();
    for (const label of Object.keys(blob.blockLabels)) {
        if (!label.startsWith('component.'))
            continue;
        let name = label.substring('component.'.length);
        name = name.indexOf('.') !== -1 ? name.substring(0, name.indexOf('.')) : name;
        ret.add(name);
    }
    return ret;
}
