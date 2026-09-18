import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    // React 19 新规则：挂载即取数/监听布局的模式（shadcn 样板同样命中），降级为警告
    "react-hooks/set-state-in-effect": "warn",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  // Electron/Node 原生脚本（desktop/**）是 CommonJS 运行时，require() 为正确写法
  files: ["desktop/**/*.js"],
  rules: {
    "@typescript-eslint/no-require-imports": "off",
  },
}, {
  // .recon/ 是本机审计/冒烟脚本的暂存目录（已在 .gitignore 里，不进仓库、不进 CI）：
  // 里面的东西是一次性的排查工具，用 CommonJS / require 属于正常写法，不该被 lint 拦。
  // .workbuddy/ 同理：它是本机 AI 工作区数据（项目记忆 + 审计解包产物），也随工作目录走、
  // 不入库；里面的 asar_out/ 是从 app.asar 里解出来的**副本**，lint 它毫无意义，
  // 却会因为 `#!` 不在首行 / require 写法报一堆假错，把 `npm run lint` 整个弄红。
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "release/**", "resources/**", "next-env.d.ts", "examples/**", "skills", ".recon/**", ".pshims/**", ".workbuddy/**"]
}];

export default eslintConfig;
