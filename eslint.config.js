import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/artifacts/**',
      '**/.next/**',
      // The browser suites' own build directory (PH-24.14): generated, like .next.
      '**/.next-stat/**',
      // Agent worktrees. Cycle Audit 7 ran eight auditors in isolated trees
      // under here — 3.5 GB of full repository copies — and ESLint walked into
      // them and aborted on heap exhaustion (exit 134). `.gitignore` does not
      // reach ESLint; this does.
      '**/.claude/**',
      // Next.js generates these and lints the web app itself during `next build`
      // with its own ruleset. Linting a generated declaration file here only
      // produces noise about a triple-slash reference the framework requires.
      'apps/web/next-env.d.ts',
      'apps/web/next.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Root-level config files live outside every composite TS project; type-aware
    // rules cannot resolve them and would report only false positives.
    files: [
      '*.config.ts',
      '*.config.js',
      'eslint.config.js',
      'vitest.setup.*.ts',
      'vitest.reporter.*.ts',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off' },
  },
  {
    // Generation code must stay replayable and portable. The guardrail test
    // suite is the authority; these rules give the same feedback in the editor.
    files: ['packages/*/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Ambient randomness cannot be replayed or isolated per asset. Draw from a RandomStream.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Ambient time makes a module unreplayable. Take a Clock instead.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'Ambient time makes a module unreplayable. Take a Clock instead.',
        },
        {
          selector:
            'MemberExpression[object.name="Math"][property.name=/^(log|log2|log10|log1p|exp|expm1|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)$/]',
          message:
            'ECMAScript does not specify this function exactly, so results differ between engines. Use the kernel portable equivalent.',
        },
        {
          selector: 'BinaryExpression[operator="**"]',
          message:
            'The ** operator is implementation-approximated. Use an explicit constant or a portable helper.',
        },
      ],
    },
  },
  {
    files: ['tools/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  prettier,
);
