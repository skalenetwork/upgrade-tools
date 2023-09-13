/* eslint-env node */
module.exports = {
    "extends": [
        // "eslint:all",
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
        "object-curly-spacing": "error",
        "one-var": [
            "error",
            "never"
        ],
        "padded-blocks": [
            "error",
            "never"
        ]
    }
};
