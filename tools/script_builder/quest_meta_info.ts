import {ScriptBlob} from "../../share/script/blob";
import {StaticEvalCtx} from "../../share/script/eval_ctx";
import {ScriptEvaluator} from "../../share/script/evaluator";
import {QuestMeta, QuestMetaFile} from "../../share/quest/quest_data";

export function generateQuestMeta(blob: ScriptBlob): QuestMetaFile {
    const componentNames = collectQuestNames(blob);

    const ret: {[id: string]: QuestMeta} = {}
    for (const name of componentNames) {
        const o: any = {id: name, name: name, requires: []};

        let ctx = new StaticEvalCtx(blob);
        ScriptEvaluator.start(ctx, `quest.${name}.meta`);
        if (ScriptEvaluator.update(ctx))
            throw new Error('Evaluation did not complete');
        for (const k of Object.getOwnPropertyNames(ctx.jsProps))
            o[k] = ctx.jsProps[k];

        o.mightUnlock = [];
        ret[name] = o;
    }

    for (const questMeta of Object.values(ret)) {
        for (const requires of questMeta.requires)
            if (requires !== 'never')
                ret[requires].mightUnlock.push(questMeta.id);
    }

    return {quests: ret};
}

function collectQuestNames(blob: ScriptBlob) {
    const ret = new Set<string>();
    for (const label of Object.keys(blob.blockLabels)) {
        if (!label.startsWith('quest.'))
            continue;
        let name = label.substring('quest.'.length);
        name = name.indexOf('.') !== -1 ? name.substring(0, name.indexOf('.')) : name;
        ret.add(name);
    }
    return ret;
}
