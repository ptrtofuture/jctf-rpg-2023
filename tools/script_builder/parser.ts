import {OP_CHOICE, OP_DIALOGUE, OP_SETNAME} from "../../share/script/npc_talk";
import {OP_CALL, OP_JSEXEC, OP_JSIF} from "../../share/script/control_opcodes";
import {ScriptBlob} from "../../share/script/blob";
import {parseSync} from "@babel/core";
import {genJs, makeReturnStatement, rewriteJs} from "./js_rewriter";
import {Expression} from "@babel/types";

const PRE_INDENT = "indent";
const PRE_NAMESPACE = "namespace";
const PRE_LABEL = "label";
const PRE_SETNAME = "setname";
const PRE_DIALOGUE = "dialogue";
const PRE_CHOICE = "choice";
const PRE_JS = "js";
const PRE_IF = "if";
const PRE_ELIF = "elif";
const PRE_ELSE = "else";

const REGEX_NAMESPACE = /^namespace ([a-zA-Z0-9_.]+)$/;
const REGEX_IF = /^(if|elif) (.*):$/;
const REGEX_ELSE = /^else:$/;
const REGEX_LABEL = /^[a-zA-Z0-9_.]+:$/;
const REGEX_SETNAME = /^([a-zA-Z0-9_.]+) is (.*)$/;
const REGEX_DIALOGUE = /^([a-zA-Z0-9_.]+): (.*)$/;
const REGEX_CHOICE = /^> (.*)$/;
const REGEX_WHITESPACE = /^[ \t]*$/;


export class ScriptParser {

    blocks: any[][];
    blockLabels: {[name: string]: number};
    private blockLocalLabels: {[name: string]: number};
    private jsCode: Expression[];

    constructor() {
        this.blocks = [];
        this.blockLabels = {};
        this.blockLocalLabels = {};
        this.jsCode = [];
    }

    *_preparse(lines: string[]): any {
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const [indent, indentCharCount] = this._getLineIndent(line);
            line = line.substring(indentCharCount);

            if (REGEX_WHITESPACE.test(line))
                continue;

            yield {"type": PRE_INDENT, "indent": indent};

            if (REGEX_NAMESPACE.test(line)) {
                const res = line.match(REGEX_NAMESPACE)!;
                yield {"type": PRE_NAMESPACE, "name": res[1]};
            } else if (REGEX_IF.test(line)) {
                const res = line.match(REGEX_IF)!;
                const parsed = parseSync(res[2], {
                    babelrc: false,
                    configFile: false,
                    parserOpts: {allowReturnOutsideFunction: true}
                })!;
                if (res[1] === 'if')
                    yield {"type": PRE_IF, "code": parsed, "lineno": i, "indent": indent};
                else
                    yield {"type": PRE_ELIF, "code": parsed, "lineno": i, "indent": indent};
            } else if (REGEX_ELSE.test(line)) {
                yield {"type": PRE_ELSE, "indent": indent};
            } else if (REGEX_LABEL.test(line)) {
                yield {"type": PRE_LABEL, "label": line.substring(0, line.length - 1)};
            } else if (REGEX_SETNAME.test(line)) {
                const res = line.match(REGEX_SETNAME)!;
                yield {"type": PRE_SETNAME, "id": res[1], "value": res[2]};
            } else if (REGEX_DIALOGUE.test(line)) {
                const res = line.match(REGEX_DIALOGUE)!;
                yield {"type": PRE_DIALOGUE, "id": res[1], "text": res[2]};
            } else if (REGEX_CHOICE.test(line)) {
                const res = line.match(REGEX_CHOICE)!;
                yield {"type": PRE_CHOICE, "text": res[1], "indent": indent};
            } else if (REGEX_IF.test(line)) {
                const res = line.match(REGEX_CHOICE)!;
                yield {"type": PRE_CHOICE, "text": res[1], "indent": indent};
            } else {
                let start = i;
                let code = lines[i];
                while (true) {
                    try {
                        const parsed = parseSync(code, {
                            babelrc: false,
                            configFile: false,
                            parserOpts: {allowReturnOutsideFunction: true}
                        })!;
                        yield {"type": PRE_JS, "code": parsed, "lineno": i};
                        break;
                    } catch (e: any) {
                        let eany = e as any;
                        if (e instanceof SyntaxError &&
                            (eany.reasonCode === 'UnterminatedComment' ||
                            (eany.reasonCode === 'UnexpectedToken' &&
                                eany.loc.line === i - start + 1 &&
                                eany.loc.index >= line.length - 1)) &&
                            ++i < lines.length) {
                            line = lines[i];
                            code += "\n";
                            code += line;
                        } else {
                            throw e;
                        }
                    }
                }
            }
        }
    }

    _getLineIndent(line: string): [number, number] {
        let indent = 0, indentCharCount = 0;
        for (let i = 0; i < line.length; i++) {
            const c = line.charAt(i);
            if (c == ' ') {
                ++indent;
                ++indentCharCount;
            } else if (c == '\t') {
                indent = Math.ceil((indent + 1) / 4) * 4;
                ++indentCharCount;
            } else {
                break;
            }
        }
        return [indent, indentCharCount];
    }

    _getBlockIdForLabel(label: string) {
        const isGlobal = label.startsWith("global.") || label.startsWith("component.") || label.startsWith("quest.");
        const labelPool = isGlobal ? this.blockLabels : this.blockLocalLabels;
        if (label.startsWith("global."))
            label = label.substring("global.".length);
        if (!(label in labelPool)) {
            labelPool[label] = this.blocks.length;
            this.blocks.push([]);
        }
        return labelPool[label];
    }

    parse(lines: string[], fileName: string) {
        this.blockLocalLabels = {};
        let namespace = '';
        let blockStack: [number, any[]][] = [];
        let initBlockId = -1;
        const ensureCurrentBlock = () => {
            if (blockStack.length === 0) {
                initBlockId = this._getBlockIdForLabel("$init");
                blockStack.push([0, this.blocks[initBlockId]]);
            }
            return blockStack.at(-1)![1];
        }
        for (const v of this._preparse(lines)) {
            switch (v.type) {
                case PRE_INDENT:
                    while (blockStack.length > 0 && blockStack.at(-1)![0] > v.indent)
                        blockStack.pop();
                    break;
                case PRE_NAMESPACE:
                    namespace = v.name;
                    continue;
                case PRE_LABEL:
                    blockStack = [[0, this.blocks[this._getBlockIdForLabel(namespace ? `${namespace}.${v.label}` : v.label)]]];
                    if (initBlockId !== -1)
                        ensureCurrentBlock().push(OP_CALL, initBlockId);
                    break;
                case PRE_SETNAME:
                    ensureCurrentBlock().push(OP_SETNAME, v.id, v.value);
                    break;
                case PRE_DIALOGUE:
                    ensureCurrentBlock().push(OP_DIALOGUE, v.id, v.text);
                    break;
                case PRE_CHOICE: {
                    const subBlockId = this.blocks.length;
                    const subBlock: any[] = [];
                    this.blocks.push(subBlock);

                    if (ensureCurrentBlock().at(-3) === OP_DIALOGUE) {
                        const dialogueInfo = ensureCurrentBlock().splice(ensureCurrentBlock().length - 3, 3);
                        ensureCurrentBlock().push(OP_CHOICE, dialogueInfo[1], dialogueInfo[2], [], []);
                    }
                    if (ensureCurrentBlock().at(-5) !== OP_CHOICE)
                        ensureCurrentBlock().push(OP_CHOICE, '', '', [], []);
                    ensureCurrentBlock().at(-2).push(v.text); // choice names
                    ensureCurrentBlock().at(-1).push(subBlockId); // choice blocks
                    blockStack.push([v.indent + 1, subBlock]);
                    break;
                }
                case PRE_JS:
                    ensureCurrentBlock().push(OP_JSEXEC, this.jsCode.length);
                    this.jsCode.push(rewriteJs(v.code, `[${this.jsCode.length}]: ${fileName}:${v.lineno}`));
                    break;
                case PRE_IF:
                case PRE_ELIF: {
                    const subBlockId = this.blocks.length;
                    const subBlock: any[] = [];
                    this.blocks.push(subBlock);

                    if (v.type === PRE_IF) {
                        ensureCurrentBlock().push(OP_JSIF, [this.jsCode.length], [subBlockId], -1);
                    } else {
                        if (ensureCurrentBlock().at(-4) !== OP_JSIF)
                            throw new Error("Bad elif");
                        ensureCurrentBlock().at(-3).push(this.jsCode.length);
                        ensureCurrentBlock().at(-2).push(subBlockId);
                    }
                    makeReturnStatement(v.code);
                    this.jsCode.push(rewriteJs(v.code, `[${this.jsCode.length}]: ${fileName}:${v.lineno}`));
                    blockStack.push([v.indent + 1, subBlock]);
                    break;
                }
                case PRE_ELSE: {
                    const subBlockId = this.blocks.length;
                    const subBlock: any[] = [];
                    this.blocks.push(subBlock);

                    if (ensureCurrentBlock().at(-4) !== OP_JSIF)
                        throw new Error("Bad else");
                    ensureCurrentBlock()[ensureCurrentBlock().length - 1] = subBlockId;
                    blockStack.push([v.indent + 1, subBlock]);
                }
            }
        }
    }

    toBlob(): ScriptBlob {
        return new ScriptBlob(this.blocks, this.blockLabels);
    }

    toJsScript() {
        return genJs(this.jsCode);
    }
}
