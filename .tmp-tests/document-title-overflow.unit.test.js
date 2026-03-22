"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
function readProjectFile(relativePath) {
    return (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), relativePath), 'utf8');
}
async function main() {
    await run('shared document select value keeps truncation classes centralized for compact filename headers', () => {
        const componentSource = readProjectFile('src/components/document-select-value.tsx');
        strict_1.default.equal(componentSource.includes('FileNameText'), true);
        strict_1.default.equal(componentSource.includes('truncate'), true);
        strict_1.default.equal(componentSource.includes('min-w-0'), true);
        strict_1.default.equal(componentSource.includes('max-w-full'), true);
    });
    await run('chat, upload, knowledge, practice, and predictions use the shared truncation renderer', () => {
        const files = [
            'src/app/dashboard/chat/page.tsx',
            'src/components/upload/upload-center.tsx',
            'src/app/dashboard/knowledge/page.tsx',
            'src/app/dashboard/practice/page.tsx',
            'src/app/dashboard/predictions/page.tsx',
        ];
        for (const file of files) {
            const source = readProjectFile(file);
            strict_1.default.equal(source.includes("DocumentSelectValue"), true, `expected ${file} to use DocumentSelectValue`);
        }
    });
    await run('document rows still enforce overflow-hidden containers around filename text', () => {
        const documentsPage = readProjectFile('src/app/dashboard/documents/page.tsx');
        const uploadCenter = readProjectFile('src/components/upload/upload-center.tsx');
        const chatPage = readProjectFile('src/app/dashboard/chat/page.tsx');
        strict_1.default.equal(documentsPage.includes('flex min-w-0 items-center gap-2 overflow-hidden'), true);
        strict_1.default.equal(uploadCenter.includes('flex min-w-0 items-center gap-2 overflow-hidden'), true);
        strict_1.default.equal(chatPage.includes('Chatting with:'), true);
        strict_1.default.equal(chatPage.includes('max-w-full'), true);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
