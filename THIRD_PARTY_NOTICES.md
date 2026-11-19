# Third-Party Notices

`public/vendor/cm6/editor.bundle.js` bundles the following MIT-licensed projects:

- CodeMirror 6 packages (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/language`, and related packages)
- `@replit/codemirror-vim`
- `@replit/codemirror-vim-core`
- `@codemirror/legacy-modes`
- `@codemirror/theme-one-dark`

Their full license texts are available in `node_modules/` after `npm install`, or from the upstream repositories.

`public/vendor/xterm/terminal.bundle.js` bundles `@xterm/xterm` and `@xterm/addon-fit` (MIT).
The server uses `node-pty` (MIT) and `ws` (MIT).

`public/vendor/three/animation.bundle.js` bundles `three` and its `OrbitControls` addon (MIT).
Animation HTML files exported by Code Reader embed this bundled runtime and can be opened offline without a CDN.

The project source itself is licensed under the MIT License; see [LICENSE](LICENSE).