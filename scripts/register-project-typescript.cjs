const { Module, registerHooks } = require('node:module');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { transformSync } = require('next/dist/build/swc');

// Next.js 외부에서 실행되는 워커와 통합 테스트도 앱과 같은 별칭과 SWC 변환을 사용한다.
Module._extensions['.ts'] = (module, filename) => {
  const { code } = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'typescript' } },
    module: { type: 'commonjs' },
  });
  module._compile(code, filename);
};

registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('@/') ? join(__dirname, '../src', specifier.slice(2)) : specifier, context);
  },
});
