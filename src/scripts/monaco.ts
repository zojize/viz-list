import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

monaco.languages
  .getLanguages()
  .find(lang => lang.id === 'cpp')!
  // @ts-expect-error: loader should exist but untyped
  .loader()
  .then((result: any) =>
    // add '->' to operators
    monaco.languages.setMonarchTokensProvider('cpp', {
      ...result.language,
      operators: [
        ...result.language.operators,
        '->',
      ],
    }))

// eslint-disable-next-line no-restricted-globals
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new JsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new CssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new HtmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new TsWorker()
    }
    return new EditorWorker()
  },
}
