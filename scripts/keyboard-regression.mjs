// Self-contained Chrome/CDP keyboard regression. No user workspace or LSP required.
// RUN_EXISTING_BROWSER=1 also runs browser-check.mjs against the same isolated server.
// Browser profiles and application data live outside the fixture Git repository.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
const sandbox = mkdtempSync(path.join(os.tmpdir(), "cr-keys-"));
const root = path.join(sandbox, "repo");
mkdirSync(root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = "http://127.0.0.1:8877";
let chrome, socket;
execFileSync("git", ["init", "-b", "main", root]);
for (const name of ["a.js", "b.js", "c.js", "example.js", "extra.js"])
  writeFileSync(
    path.join(root, name),
    `function reader_${name.replace(/\.js$/, "")}() {\n` +
      Array.from({ length: 100 }, (_, i) => `  const value${i} = ${i};`).join("\n") +
      "\n  return value0;\n}\n",
  );
mkdirSync(path.join(root, "src"));
writeFileSync(
  path.join(root, "src", "sample.c"),
  Array.from(
    { length: 300 },
    (_, i) => `int demo_${i}(void) {\n  return ${i};\n}\n`,
  ).join("\n"),
);
mkdirSync(path.join(root, "drivers", "usb"), {recursive:true});
writeFileSync(path.join(root, "drivers", "usb", "xhci.c"), "int controller;\n");
writeFileSync(path.join(root, "src", "xhci.c"), "int duplicate;\n");
execFileSync("git", ["-C", root, "add", "."]);
execFileSync("git", [
  "-C",
  root,
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.com",
  "commit",
  "-m",
  "fixture",
]);
writeFileSync(
  path.join(sandbox, "profile.json"),
  JSON.stringify({
    options: { number: true, relativenumber: false, cursorline: true },
  }),
);
const server = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    PORT: "8877",
    CODE_READER_NVIM: "/bin/cat",
    CODE_READER_PROFILE_JSON: path.join(sandbox, "profile.json"),
    CODE_READER_DATA_DIR: path.join(sandbox, "data"),
  },
  stdio: "ignore",
});
let failures = 0;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/workspace")).ok) break;
    } catch {}
    await sleep(100);
  }
  const response = await fetch(base + "/api/repositories/open-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: root }),
  });
  assert(response.ok);
  chrome = spawn(
    process.env.CHROME_BIN ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=9444",
      `--user-data-dir=${sandbox}/chrome`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      target = await (
        await fetch("http://127.0.0.1:9444/json/new?about:blank", {
          method: "PUT",
        })
      ).json();
      break;
    } catch {}
    await sleep(100);
  }
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => socket.once("open", r));
  let id = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await sleep(50);
    }
    throw Error("Timeout " + expression);
  };
  const key = async (key, code, modifiers = 0) => {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      windowsVirtualKeyCode: ({Enter:13, Escape:27, ArrowUp:38, ArrowDown:40, Tab:9})[key],
      key,
      code,
      modifiers,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      modifiers,
    });
  };
  const cursor = () => evaluate("window.__ts.snapshot().editor.cursor");
  await send("Page.navigate", { url: base });
  await wait("Boolean(window.__ts?.snapshot().fileCount)");
  await evaluate("window.__ts.openFile('a.js', 10)");

  // Deterministic reference results; all navigation still uses the real gr route.
  await evaluate(
    `(() => {const original=window.fetch; window.fetch=async (...args)=>{if(String(args[0]).endsWith('/lsp/references')) {await new Promise(r=>setTimeout(r,80));return new Response(JSON.stringify({locations:[1,2,3].map(line=>({path:'a.js',line,character:0}))}),{headers:{'content-type':'application/json'}});} return original(...args);}; document.querySelector('#explanation-content').classList.remove('empty-insight'); document.querySelector('#explanation-content').innerHTML='<div style="height:5000px">explanation</div>';})()`,
  );
  const test = async (name, fn) => {
    try {
      await fn();
      console.log("PASS", name);
    } catch (e) {
      failures++;
      console.error("FAIL", name, e.message);
    }
  };
  const reset = async () => {
    await evaluate(
      "window.__crPanels.hideAll(); document.querySelector('#quickpick').hidden=true",
    );
    await evaluate("window.__ts.openFile('a.js', 10)");
  };
  for (const panel of ["B", "I", "R"])
    for (let repeat = 0; repeat < 2; repeat++)
      await test(`${panel} open ${repeat + 1}: j/k and Escape`, async () => {
        await reset();
        const before = await cursor();
        if (panel === "R") {
          await key("g", "KeyG");
          await key("r", "KeyR");
          await wait("!document.querySelector('#quickpick').hidden");
        } else await key(panel.toLowerCase(), "Key" + panel, 3);
        const read = () =>
          evaluate(
            panel === "B"
              ? "document.querySelector('#file-tree .key-focus')?.dataset.path"
              : panel === "I"
                ? "document.querySelector('#explanation-content').scrollTop"
                : "[...document.querySelectorAll('.quickpick-row')].findIndex(r=>r.classList.contains('active'))",
          );
        const first = await read();
        await key("j", "KeyJ");
        assert.notDeepEqual(await read(), first);
        assert.deepEqual(await cursor(), before);
        await key("k", "KeyK");
        assert.deepEqual(await read(), first);
        assert.deepEqual(await cursor(), before);
        await key("Escape", "Escape");
        await sleep(180);
        await key("j", "KeyJ");
        assert.notDeepEqual(await cursor(), before);
      });
  await test("first tree open while rows are loading owns j/k immediately", async () => {
    await reset();
    const before = await cursor();
    await evaluate(
      "window.__savedTree = [...document.querySelector('#file-tree').childNodes]; document.querySelector('#file-tree').replaceChildren()",
    );
    try {
      await key("b", "KeyB", 3);
      await key("j", "KeyJ");
      assert.deepEqual(await cursor(), before);
    } finally {
      await evaluate(
        "document.querySelector('#file-tree').replaceChildren(...window.__savedTree)",
      );
    }
    await sleep(200);
    assert.equal(await evaluate("document.activeElement.id"), "file-tree");
    await key("Escape", "Escape");
  });
  await test("empty tree Escape restores code immediately and after retries", async () => {
    await reset();
    const before = await cursor();
    await evaluate(
      "window.__savedTree=[...document.querySelector('#file-tree').childNodes]; document.querySelector('#file-tree').replaceChildren()",
    );
    try {
      await key("b", "KeyB", 3);
      await key("Escape", "Escape");
      await sleep(300);
      await key("j", "KeyJ");
      assert.notDeepEqual(await cursor(), before);
    } finally {
      await evaluate(
        "document.querySelector('#file-tree').replaceChildren(...window.__savedTree)",
      );
    }
  });
  for (const panel of ["B", "I", "R"])
    await test(`${panel} retains focus across delayed source and preview loading`, async () => {
      await reset();
      await evaluate(
        `(() => {const original=window.fetch; window.fetch=async(...args)=>{if(String(args[0]).includes('/file?')) await new Promise(r=>setTimeout(r,350)); return original(...args);}; window.__loading=window.__ts.openFile('b.js',10);})()`,
      );
      if (panel === "R") {
        await key("g", "KeyG");
        await key("r", "KeyR");
        await wait("!document.querySelector('#quickpick').hidden");
      } else await key(panel.toLowerCase(), "Key" + panel, 3);
      await evaluate("window.__loading");
      await sleep(800);
      assert.equal(
        await evaluate(
          panel === "B"
            ? "document.activeElement.id === 'file-tree'"
            : panel === "I"
              ? "Boolean(document.activeElement.closest('.insights'))"
              : "document.activeElement.id === 'quickpick'",
        ),
        true,
      );
      const before = await cursor();
      await key("j", "KeyJ");
      assert.deepEqual(await cursor(), before);
      await key("Escape", "Escape");
    });
  await test("rapid I → B keeps newest window", async () => {
    await reset();
    await evaluate(
      "document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{key:'i',code:'KeyI',ctrlKey:true,altKey:true,bubbles:true})); document.querySelector('#explanation-content').dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,altKey:true,bubbles:true}));",
    );
    await sleep(200);
    assert.equal(await evaluate("document.activeElement.id"), "file-tree");
  });
  await test("tree Escape cancels delayed focus", async () => {
    await reset();
    await key("b", "KeyB", 3);
    await key("Escape", "Escape");
    await sleep(400);
    assert.equal(
      await evaluate("Boolean(document.activeElement.closest('#editor-host'))"),
      true,
    );
  });
  await test("tree j/k follows the row focused with Tab", async () => {
    await reset();
    await key("b", "KeyB", 3);
    await key("Tab", "Tab");
    await key("Tab", "Tab");
    await key("Tab", "Tab");
    const focused = await evaluate("document.activeElement.dataset.path");
    const next = await evaluate("document.activeElement.nextElementSibling.dataset.path");
    await key("j", "KeyJ");
    assert.equal(await evaluate("document.querySelector('#file-tree .key-focus')?.dataset.path"), next);
    await key("k", "KeyK");
    assert.equal(await evaluate("document.querySelector('#file-tree .key-focus')?.dataset.path"), focused);
  });
  await test("tree activation hands keyboard to code without delayed theft", async () => {
    await reset();
    await key("b", "KeyB", 3);
    await key("Enter", "Enter");
    await wait("Boolean(document.activeElement.closest('#editor-host'))");
    await sleep(350);
    assert.equal(await evaluate("Boolean(document.activeElement.closest('#editor-host'))"), true);
    const before = await cursor();
    await key("j", "KeyJ");
    assert.notDeepEqual(await cursor(), before);
  });
  await test("tree redraw preserves focused row and j/k selection", async () => {
    await reset();
    await key("b", "KeyB", 3);
    await key("Tab", "Tab");
    await key("Tab", "Tab");
    await key("Tab", "Tab");
    const focused = await evaluate("document.activeElement.dataset.path");
    await evaluate("import('/features/tree.js').then(m => m.renderTree())");
    assert.equal(await evaluate("document.querySelector('#file-tree .key-focus')?.dataset.path"), focused);
    assert.equal(await evaluate("Boolean(document.activeElement.closest('#file-tree'))"), true);
  });
  await test("tree input host rejects text, deletion, paste and drop", async () => {
    await reset();
    await key("b", "KeyB", 3);
    const html = await evaluate("document.querySelector('#file-tree').innerHTML");
    await send("Input.insertText", { text: "accidental text" });
    await key("Backspace", "Backspace");
    assert.equal(await evaluate("document.querySelector('#file-tree').innerHTML"), html);
    assert.equal(await evaluate(`['beforeinput','paste','drop'].every(type => {
      const event = new Event(type, {bubbles:true,cancelable:true});
      document.querySelector('#file-tree').dispatchEvent(event);
      return event.defaultPrevented;
    })`), true);
    assert.equal(await evaluate("document.querySelector('#file-tree').isContentEditable"), true);
  });
  await test("global basename reveals collapsed ancestors and selects exact file", async () => {
    await reset();
    await evaluate("import('/core/state.js').then(({state})=>{state.collapsed.add('src');state.collapsed.add('drivers');state.collapsed.add('drivers/usb');return import('/features/tree.js').then(m=>m.renderTree())})");
    await key('b', 'KeyB', 3);
    for (const letter of 'xhci.c') await key(letter, letter === '.' ? 'Period' : 'Key'+letter.toUpperCase());
    assert.equal(await evaluate("document.querySelector('#file-tree .key-focus')?.dataset.path"), 'drivers/usb/xhci.c');
    await key('Enter', 'Enter');
    await wait("window.__ts.snapshot().currentFile === 'drivers/usb/xhci.c'");
    await wait("Boolean(document.activeElement.closest('.cm-editor'))");
  });
  await test("search Enter exits input repeatedly and j/k navigate without changing text", async () => {
    await reset();
    const original = await evaluate('window.__ts.getValue()');
    for (const term of ['value10', 'value20', 'not_present_anywhere']) {
      await key('/', 'Slash');
      await wait("Boolean(document.querySelector('.cm-vim-panel input'))");
      await send('Input.insertText', {text:term});
      await key('Enter','Enter');
      await sleep(100);
      assert.equal(await evaluate("Boolean(document.activeElement.closest('.cm-vim-panel'))"), false);
      const before = await cursor();
      await key('j','KeyJ');
      assert.notDeepEqual(await cursor(),before);
      await key('k','KeyK');
      assert.deepEqual(await cursor(),before);
      assert.equal(await evaluate('window.__ts.getValue()'), original);
    }
  });
  await test("search Up recalls recent and older queries; Enter commits recalled query", async () => {
    await reset();
    await key('/','Slash');
    await wait("Boolean(document.querySelector('.cm-vim-panel input'))");
    await key('ArrowUp','ArrowUp');
    assert.equal(await evaluate("document.querySelector('.cm-vim-panel input').value"),'not_present_anywhere');
    await key('ArrowUp','ArrowUp');
    assert.equal(await evaluate("document.querySelector('.cm-vim-panel input').value"),'value20');
    await key('Enter','Enter');
    await sleep(100);
    assert.equal(await evaluate("Boolean(document.activeElement.closest('.cm-vim-panel'))"),false);
    assert.equal((await cursor()).line,22);
    const before = await cursor();
    await key('j','KeyJ');
    assert.notDeepEqual(await cursor(), before);
  });
  assert.equal(failures, 0, `${failures} keyboard regressions`);
  console.log("RESULT PASS keyboard scenarios=20 failures=0");
  if (process.env.RUN_EXISTING_BROWSER) {
    await evaluate("window.__ts.openFile('src/sample.c',10)");
    await sleep(1500);
    const browserCheck = spawn(
      process.execPath,
      ["scripts/browser-check.mjs"],
      {
        env: {
          ...process.env,
          CODE_READER_URL: base,
          CHROME_BIN:
            process.env.CHROME_BIN ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        },
        stdio: "inherit",
      },
    );
    assert.equal(
      await new Promise((r) => browserCheck.once("exit", r)),
      0,
      "existing browser checks",
    );
  }
} finally {
  socket?.close();
  chrome?.kill();
  server.kill();
  await sleep(500);
  rmSync(sandbox, { recursive: true, force: true });
}
