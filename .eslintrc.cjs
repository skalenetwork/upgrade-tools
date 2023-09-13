/* eslint-env node */
module.exports = {
    "extends": [
        "eslint:all",
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended"
    ],
    "ignorePatterns": [
        "dist/**",
        "typechain-types/**"
    ],
    "parser": "@typescript-eslint/parser",
    "plugins": ["@typescript-eslint"],
    "root": true,
    "rules": {
        "lines-around-comment": [
            "error",
            {"allowBlockStart": true}
        ],
        "object-curly-spacing": "error",
        "one-var": [
            "error",
            "never"
        ],
        "padded-blocks": [
            "error",
            "never"
        ],

        "max-lines-per-function": "warn",
        "max-params": "warn",
        "max-statements": "warn",
        "multiline-comment-style": "warn",
        "no-await-in-loop": "warn",
        "no-console": "warn",
        "no-continue": "warn",
        "no-duplicate-imports": "warn",
        "no-inline-comments": "warn",
        "no-magic-numbers": "warn",
        "no-mixed-operators": "warn",
        "no-negated-condition": "warn",
        "no-shadow": "warn",
        "no-ternary": "warn",
        "no-undefined": "warn",
        "no-underscore-dangle": "warn",
        "no-use-before-define": "warn",
        "no-warning-comments": "warn",
        "prefer-destructuring": "warn",
        "radix": "warn",
        "sort-imports": "warn",
        "sort-keys": "warn"
    }
};
