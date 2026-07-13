import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist', 'node_modules', 'eslint.config.js'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
      // The TypeScript compiler resolves types/globals (e.g. React.FormEvent under the new JSX
      // transform); ESLint's core no-undef doesn't understand TS and false-positives on them.
      'no-undef': 'off',
    },
  },
  {
    // Context files intentionally co-locate a provider component with its useX hook, types,
    // and domain constants — the standard React Context pattern. Fast-refresh granularity is
    // the only tradeoff, which is acceptable here.
    files: ['src/mock/DataContext.tsx', 'src/components/ui/toast.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
];
