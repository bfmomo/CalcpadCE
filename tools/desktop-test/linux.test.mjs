import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { LinuxTestApp, until, invoke } from './linux-test-app.mjs';

describe('Linux GTK editor', {skip: process.platform !== 'linux', concurrency: false}, () => {
    async function start(t) {
        const app = new LinuxTestApp();
        let main;
        t.after(async () => {
            try { if (t.error && main) await app.diagnostics(main); }
            finally { await app.dispose(); }
        });
        main = await app.start();
        await app.geometry(main, 50, 60);
        await app.evaluate(main, `window.testErrors = [];
            window.addEventListener('unhandledrejection', event => window.testErrors.push(String(event.reason)));
            window.calcpadBridge.confirmThreeWay = async () => 'no';`);
        return {app, main};
    }

    const content = Array.from({length: 80}, (_, i) => 'a' + i + ' = 1').join('\n');
    const keyboard = (app, handle, direction) => direction === -1
        ? app.keyChord(handle, 'ctrl', 'alt', 'minus')
        : app.keyChord(handle, 'ctrl', 'shift', 'minus');
    const at = (app, handle, tab, lineNumber, column) => until(() => app.evaluate(handle, `
        window.calcpadTabs.activeId === ${JSON.stringify(tab)}
        && window.calcpadActiveEditor.getPosition().lineNumber === ${lineNumber}
        && window.calcpadActiveEditor.getPosition().column === ${column}`), `GTK history at ${tab}:${lineNumber}:${column}`);

    test('navigation history restores cursor positions and selections with Linux shortcuts and mouse buttons', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const first = await app.evaluate(main, `window.calcpadTabs.newUntitled(${JSON.stringify(content)}, 'History A');
            window.calcpadActiveEditor.setPosition({lineNumber: 3, column: 2});
            window.calcpadActiveEditor.setPosition({lineNumber: 30, column: 3});
            window.calcpadTabs.activeId`);
        await keyboard(app, main, -1);
        await at(app, main, first, 3, 2);
        await app.historyMouse(main, 1);
        await at(app, main, first, 30, 3);
        await app.historyMouse(main, -1);
        await at(app, main, first, 3, 2);
        await keyboard(app, main, 1);
        await at(app, main, first, 30, 3);

        await app.evaluate(main, `window.calcpadActiveEditor.setPosition({lineNumber: 33, column: 2});
            window.calcpadBridge.handleMessage({type: 'goToLine', line: 36})`);
        await at(app, main, first, 36, 1);
        await keyboard(app, main, -1);
        await at(app, main, first, 33, 2);
        await keyboard(app, main, 1);
        await at(app, main, first, 36, 1);

        const selection = {selectionStartLineNumber: 36, selectionStartColumn: 5, positionLineNumber: 35, positionColumn: 2};
        await app.evaluate(main, `window.calcpadActiveEditor.setSelection(${JSON.stringify(selection)});
            window.calcpadActiveEditor.setPosition({lineNumber: 60, column: 1})`);
        await keyboard(app, main, -1);
        await at(app, main, first, 35, 2);
        const restored = await app.evaluate(main, 'window.calcpadActiveEditor.getSelection()');
        for (const [key, value] of Object.entries(selection)) assert.equal(restored[key], value);
    });

    test('navigation history accepts Linux shortcuts and side buttons from the preview', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const id = await app.evaluate(main, `window.calcpadTabs.newUntitled(${JSON.stringify(content)}, 'Preview history');
            window.calcpadActiveEditor.setPosition({lineNumber: 3, column: 2});
            window.calcpadActiveEditor.setPosition({lineNumber: 30, column: 3});
            window.calcpadTabs.activeId`);
        const preview = '.preview-frame:not(.preview-frame-back)';
        await until(() => app.evaluate(main, `!!document.querySelector(${JSON.stringify(preview)})?.srcdoc`), 'GTK history preview ready');
        await app.evaluate(main, `document.querySelector(${JSON.stringify(preview)}).focus()`);
        await keyboard(app, main, -1);
        await at(app, main, id, 3, 2);
        await app.historyMouse(main, 1, preview);
        await at(app, main, id, 30, 3);
    });

    test('navigation history crosses tabs and split groups and skips closed tabs', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const first = await app.evaluate(main, `window.calcpadTabs.newUntitled(${JSON.stringify(content)}, 'History A');
            window.calcpadActiveEditor.setPosition({lineNumber: 30, column: 3});
            window.calcpadTabs.activeId`);
        const second = await app.evaluate(main, `window.calcpadTabs.newUntitled('b = 2\\nc = 3', 'History B');
            window.calcpadActiveEditor.setPosition({lineNumber: 2, column: 3});
            window.calcpadTabs.activeId`);
        await keyboard(app, main, -1);
        await at(app, main, first, 30, 3);
        await keyboard(app, main, 1);
        await at(app, main, second, 2, 3);
        await app.evaluate(main, invoke('plugin:event|emit_to', {
            target: {kind: 'WebviewWindow', label: 'main'}, event: 'menu-click', payload: {id: 'split-editor'},
        }));
        const linked = await until(() => app.evaluate(main,
            `document.querySelector('[data-tab-group="g1"] [data-tab-id]')?.dataset.tabId`), 'GTK history split ready');
        await at(app, main, linked, 1, 1);
        await keyboard(app, main, -1);
        await at(app, main, second, 2, 3);
        await app.historyMouse(main, 1);
        await at(app, main, linked, 1, 1);
        await keyboard(app, main, -1);
        await at(app, main, second, 2, 3);
        await app.evaluate(main, `const id = window.calcpadTabs.newUntitled('closed = 1', 'Closed history tab');
            window.calcpadTabs.close(id)`);
        await at(app, main, second, 2, 3);
        await keyboard(app, main, -1);
        await at(app, main, first, 30, 3);
        await keyboard(app, main, 1);
        await at(app, main, second, 2, 3);
    });

    test('cross-file navigation records only the destination for new and existing GTK tabs', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const targetContent = '\n'.repeat(24) + 'target = 42\n';
        const target = path.join(app.profile, 'history-definitions.cpd');
        const source = path.join(app.profile, 'history-source.cpd');
        const sourceContent = `#include ${target}\n\nresult = target\n`;
        writeFileSync(target, targetContent);
        writeFileSync(source, sourceContent);
        const sourceId = await app.evaluate(main, `window.calcpadTabs.openFile(${JSON.stringify(source)}, ${JSON.stringify(sourceContent)})`);
        for (const existing of [false, true]) {
            if (existing) {
                await app.evaluate(main, `window.calcpadActiveEditor.setPosition({lineNumber: 7, column: 1});
                    window.calcpadTabs.activate(${JSON.stringify(sourceId)})`);
            }
            const targetId = await app.evaluate(main, `window.calcpadActiveEditor.setPosition({lineNumber: 3, column: 11});
                window.calcpadTabs.openFile(${JSON.stringify(target)}, ${JSON.stringify(targetContent)}, {lineNumber: 25, column: 1})`);
            await at(app, main, targetId, 25, 1);
            await keyboard(app, main, -1);
            await at(app, main, sourceId, 3, 11);
            await keyboard(app, main, 1);
            await at(app, main, targetId, 25, 1);
        }
    });

    test('navigation history shares selections across GTK windows and removes closed windows', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const selection = {selectionStartLineNumber: 5, selectionStartColumn: 4, positionLineNumber: 6, positionColumn: 2};
        const first = await app.evaluate(main, `window.calcpadActiveEditor.setValue(${JSON.stringify(content)});
            window.calcpadActiveEditor.setSelection(${JSON.stringify(selection)});
            window.calcpadTabs.activeId`);
        const second = await app.newWindow(main);
        const other = await app.evaluate(second.handle, `window.calcpadActiveEditor.setValue(${JSON.stringify(content)});
            window.calcpadActiveEditor.setPosition({lineNumber: 6, column: 3});
            window.calcpadBridge.confirmThreeWay = async () => 'no';
            window.calcpadTabs.activeId`);
        assert.equal(first, other, 'GTK tab IDs may match across windows');
        await app.evaluate(main, 'window.calcpadActiveEditor.setPosition({lineNumber: 60, column: 1})');
        await app.historyMouse(second.handle, -1);
        await at(app, main, first, 6, 2);
        await until(() => app.evaluate(main, 'document.hasFocus()'), 'history focuses first GTK window');
        const restored = await app.evaluate(main, 'window.calcpadActiveEditor.getSelection()');
        for (const [key, value] of Object.entries(selection)) assert.equal(restored[key], value);
        assert.equal(await app.evaluate(second.handle, 'document.hasFocus()'), false);
        await keyboard(app, main, 1);
        await at(app, second.handle, other, 6, 3);
        await until(() => app.evaluate(second.handle, 'document.hasFocus()'), 'history focuses second GTK window');
        await app.evaluate(main, 'window.calcpadActiveEditor.setPosition({lineNumber: 60, column: 1})');
        await keyboard(app, second.handle, -1);
        await at(app, main, first, 6, 2);
        await keyboard(app, main, 1);
        await at(app, second.handle, other, 6, 3);
        await app.closeWindow(second.handle);
        app.focus(await app.nativeWindow(main));
        await until(() => app.evaluate(main, 'document.hasFocus()'), 'remaining GTK window focused');
        await app.evaluate(main, 'window.calcpadActiveEditor.setPosition({lineNumber: 30, column: 1})');
        await keyboard(app, main, -1);
        await at(app, main, first, 6, 2);
        await keyboard(app, main, 1);
        await at(app, main, first, 30, 1);
    });

    test('reorders tabs with native pointer movement below the GTK menu', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const ids = await app.evaluate(main, `(() => {
            const tabs = window.calcpadTabs;
            const scratch = tabs.activeId;
            const ids = ['A', 'B', 'C'].map(title => tabs.newUntitled(title + ' = 1', title));
            tabs.close(scratch);
            tabs.activate(ids[0]);
            window.calcpadActiveEditor.executeEdits('test', [{range: {startLineNumber: 1, startColumn: 6, endLineNumber: 1, endColumn: 6}, text: '2'}]);
            return ids;
        })()`);
        await app.drag(main, ids[0], main, `[data-tab-id="${ids[2]}"]`);
        await until(async () => (await app.evaluate(main, 'window.calcpadTabs.all.map(tab => tab.title).join()')) === 'B,A,C', 'GTK tabs reordered');
        assert.equal(await app.evaluate(main, 'window.calcpadTabs.activeId'), ids[0]);
        await app.evaluate(main, 'window.calcpadActiveEditor.getModel().undo()');
        assert.equal(await app.evaluate(main, 'window.calcpadActiveEditor.getValue()'), 'A = 1');
        assert.equal(await app.evaluate(main, 'window.calcpadTabs.isDirty()'), false);
        assert.deepEqual(await app.evaluate(main, 'window.testErrors'), []);
    });

    test('Escape cancels a drag', {
        timeout: 60000,
        skip: process.env.CALCPAD_TEST_BACKEND === 'wayland' && 'Sway consumes keyboard input during native drags',
    }, async t => {
        const {app, main} = await start(t);
        const ids = await app.evaluate(main, `['A', 'B'].map(title => window.calcpadTabs.newUntitled('', title))`);
        const before = await app.evaluate(main, 'window.calcpadTabs.all');
        await app.drag(main, ids[1], main, `[data-tab-id="${ids[0]}"]`, {cancel: true});
        assert.deepEqual(await app.evaluate(main, 'window.calcpadTabs.all'), before);
    });

    test('dropping outside preserves the tabs', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const id = await app.evaluate(main, `window.calcpadTabs.newUntitled('', 'Outside')`);
        const before = await app.evaluate(main, 'window.calcpadTabs.all');
        await app.drag(main, id, main, '.tab-new', {outside: true});
        assert.deepEqual(await app.evaluate(main, 'window.calcpadTabs.all'), before);
    });

    test('moves an unsaved tab between native GTK windows', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const second = await app.newWindow(main);
        const scale = await app.evaluate(main, 'devicePixelRatio');
        await app.geometry(second.handle, 1450 * scale, 100);
        const original = await app.evaluate(main, `(() => {
            window.calcpadActiveEditor.setValue('a = 1\\nb = 2');
            window.calcpadActiveEditor.setPosition({lineNumber: 2, column: 3});
            return window.calcpadTabs.activeTab;
        })()`);
        await app.drag(main, original.id, second.handle, '.tab-new');
        await until(async () => await app.evaluate(second.handle, 'window.calcpadActiveEditor.getValue()') === 'a = 1\nb = 2', 'GTK document received');
        await until(async () => !(await app.evaluate(main, 'window.calcpadTabs.all')).some(tab => tab.id === original.id), 'source removed');
        assert.equal(await app.evaluate(second.handle, 'window.calcpadTabs.isDirty()'), true);
        assert.deepEqual(await app.evaluate(second.handle, 'window.calcpadActiveEditor.getPosition()'), {lineNumber: 2, column: 3});
        assert.equal(await app.evaluate(second.handle, 'window.calcpadTabs.activeTab.title'), original.title);
        await until(() => app.evaluate(second.handle, `(async () => (await ${invoke('draft_list')}).some(draft => draft.filePath === null))()`), 'destination recovery draft');
    });

    test('targets the front window when GTK windows overlap', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const second = await app.newWindow(main);
        const scale = await app.evaluate(main, 'devicePixelRatio');
        await app.geometry(second.handle, 500 * scale, 100);
        const original = await app.evaluate(main, `(() => {
            window.calcpadActiveEditor.setValue('overlap = 1');
            return window.calcpadTabs.activeTab;
        })()`);
        await app.drag(main, original.id, second.handle, '.tab-new', {raiseDestination: true});
        await until(async () => await app.evaluate(second.handle, 'window.calcpadActiveEditor.getValue()') === 'overlap = 1', 'front GTK window receives document');
        await until(async () => !(await app.evaluate(main, 'window.calcpadTabs.all')).some(tab => tab.id === original.id), 'covered source tab removed');
    });

    test('moves tabs between split groups without losing undo history', {timeout: 60000}, async t => {
        const {app, main} = await start(t);
        const original = await app.evaluate(main, 'window.calcpadTabs.activeId');
        await app.evaluate(main, invoke('plugin:event|emit_to', {
            target: {kind: 'WebviewWindow', label: 'main'}, event: 'menu-click', payload: {id: 'split-editor'},
        }));
        const linked = await until(() => app.evaluate(main,
            `document.querySelector('[data-tab-group="g1"] [data-tab-id]')?.dataset.tabId`), 'split GTK group ready');
        await app.evaluate(main, `document.querySelector('[data-tab-id="${original}"]').dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true}))`);
        await until(async () => await app.evaluate(main, 'window.calcpadTabs.activeId') === original, 'source GTK group active');
        const moved = await app.evaluate(main, `(() => {
            const id = window.calcpadTabs.newUntitled('', 'Moved');
            window.calcpadActiveEditor.executeEdits('test', [{range: {startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1}, text: 'moved = 1'}]);
            window.testMovedModel = window.calcpadActiveEditor.getModel();
            return id;
        })()`);
        await app.drag(main, moved, main, `[data-tab-id="${linked}"]`);
        await until(() => app.evaluate(main, `document.querySelector('[data-tab-group="g1"] .tab-title')?.textContent === 'Moved'`), 'tab moved to split GTK group');
        assert.equal(await app.evaluate(main, 'window.calcpadActiveEditor.getModel() === window.testMovedModel'), true);
        await app.evaluate(main, 'window.calcpadActiveEditor.getModel().undo()');
        assert.equal(await app.evaluate(main, 'window.calcpadActiveEditor.getValue()'), '');
    });
});
